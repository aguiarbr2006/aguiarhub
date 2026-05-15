const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const region = "southamerica-east1";

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function feePercentForMethod(method) {
  const defaults = { pix: 0, debito: 1.99, credito: 3.49, credito_parcelado: 4.99 };
  return defaults[method] || 0;
}

function buildTotals(bruto, taxaPercentual) {
  const valorBruto = Math.max(0, Number(bruto || 0));
  const pct = Math.max(0, Number(taxaPercentual || 0));
  const taxaValor = Math.round(valorBruto * (pct / 100) * 100) / 100;
  const valorLiquido = Math.round((valorBruto - taxaValor) * 100) / 100;
  return { valorBruto, taxaPercentual: pct, taxaValor, valorLiquido };
}

function mapCaptureMethod(captureMethod) {
  const key = String(captureMethod || "").toLowerCase();
  if (key.includes("pix")) return "pix";
  if (key.includes("debit")) return "debito";
  if (key.includes("parcel")) return "credito_parcelado";
  if (key.includes("credit")) return "credito";
  return "credito";
}

async function markAppointmentPaid(appointmentId, paymentPatch) {
  const ref = db.collection("appointments").doc(appointmentId);
  const snap = await ref.get();
  const current = snap.exists ? snap.data() : {};
  const pagamento = {
    ...(current.pagamento || {}),
    ...paymentPatch,
    status: "pago",
    pagoEm: paymentPatch.pagoEm || new Date().toISOString(),
  };
  await ref.set(
    {
      agendamentoId: appointmentId,
      status: "Concluído",
      pagamento,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return pagamento;
}

exports.createInfinitePayLink = functions.region(region).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login necessário.");
  }
  const appointmentId = String(data.appointmentId || "");
  const valorBruto = Number(data.valorBruto || 0);
  const descricao = String(data.descricao || "Atendimento");
  if (!appointmentId || valorBruto <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Dados do agendamento inválidos.");
  }

  const handle = process.env.INFINITEPAY_HANDLE;
  if (!handle) {
    throw new functions.https.HttpsError("failed-precondition", "INFINITEPAY_HANDLE não configurado nas secrets.");
  }

  const orderNsu = appointmentId;
  const webhookUrl = process.env.INFINITEPAY_WEBHOOK_URL || "";
  const redirectUrl = process.env.PAYMENT_REDIRECT_URL || "https://localhost";

  const body = {
    handle,
    order_nsu: orderNsu,
    redirect_url: redirectUrl,
    webhook_url: webhookUrl,
    items: [
      {
        quantity: 1,
        price: cents(valorBruto),
        description: descricao.slice(0, 120),
      },
    ],
  };

  const response = await fetch("https://api.infinitepay.io/invoices/public/checkout/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new functions.https.HttpsError("internal", `InfinitePay: ${text}`);
  }

  const payload = await response.json();
  const url = payload.url || payload.checkout_url || payload.link;
  if (!url) {
    throw new functions.https.HttpsError("internal", "InfinitePay não retornou URL.");
  }

  await db.collection("appointments").doc(appointmentId).set(
    {
      agendamentoId: appointmentId,
      pagamento: {
        status: "pendente",
        adquirente: "infinitepay",
        linkUrl: url,
        externalId: payload.invoice_slug || orderNsu,
        valorBruto,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { url, orderNsu, invoiceSlug: payload.invoice_slug || "" };
});

exports.infinitePayWebhook = functions.region(region).https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const body = req.body || {};
    const appointmentId = String(body.order_nsu || body.orderNsu || "");
    if (!appointmentId) {
      res.status(400).send("order_nsu ausente");
      return;
    }

    const metodo = mapCaptureMethod(body.capture_method || body.payment_method);
    const paidAmount = Number(body.paid_amount || body.amount || 0) / (body.paid_amount > 1000 ? 100 : 1);
    const bruto = paidAmount > 0 ? paidAmount : Number(body.amount || 0);
    const taxaPercentual = feePercentForMethod(metodo);
    const totals = buildTotals(bruto, taxaPercentual);

    await markAppointmentPaid(appointmentId, {
      metodo,
      adquirente: "infinitepay",
      externalId: String(body.invoice_slug || body.transaction_nsu || ""),
      linkUrl: body.receipt_url || "",
      observacao: "Confirmado via InfinitePay",
      ...totals,
    });

    res.status(200).send("ok");
  } catch (error) {
    console.error("infinitePayWebhook", error);
    res.status(500).send("error");
  }
});

exports.createMercadoPagoPreference = functions.region(region).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login necessário.");
  }
  const appointmentId = String(data.appointmentId || "");
  const valorBruto = Number(data.valorBruto || 0);
  const descricao = String(data.descricao || "Atendimento");
  if (!appointmentId || valorBruto <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Dados do agendamento inválidos.");
  }

  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new functions.https.HttpsError("failed-precondition", "MERCADOPAGO_ACCESS_TOKEN não configurado.");
  }

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      items: [
        {
          title: descricao.slice(0, 120),
          quantity: 1,
          unit_price: valorBruto,
          currency_id: "BRL",
        },
      ],
      external_reference: appointmentId,
      notification_url: process.env.MERCADOPAGO_WEBHOOK_URL || undefined,
      back_urls: {
        success: process.env.PAYMENT_REDIRECT_URL || "https://localhost",
        failure: process.env.PAYMENT_REDIRECT_URL || "https://localhost",
        pending: process.env.PAYMENT_REDIRECT_URL || "https://localhost",
      },
      auto_return: "approved",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new functions.https.HttpsError("internal", `Mercado Pago: ${text}`);
  }

  const preference = await response.json();
  const url = preference.init_point || preference.sandbox_init_point;
  if (!url) {
    throw new functions.https.HttpsError("internal", "Mercado Pago não retornou URL.");
  }

  await db.collection("appointments").doc(appointmentId).set(
    {
      agendamentoId: appointmentId,
      pagamento: {
        status: "pendente",
        adquirente: "mercado_pago",
        linkUrl: url,
        externalId: preference.id,
        valorBruto,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { url, preferenceId: preference.id };
});

exports.mercadoPagoWebhook = functions.region(region).https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const query = req.query || {};
    const topic = query.topic || query.type;
    const paymentId = query.id || query["data.id"];
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token || !paymentId) {
      res.status(200).send("ignored");
      return;
    }

    if (topic && topic !== "payment") {
      res.status(200).send("ignored");
      return;
    }

    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!payRes.ok) {
      res.status(200).send("ignored");
      return;
    }
    const payment = await payRes.json();
    if (payment.status !== "approved") {
      res.status(200).send("pending");
      return;
    }

    const appointmentId = String(payment.external_reference || "");
    if (!appointmentId) {
      res.status(200).send("no-ref");
      return;
    }

    const metodo =
      payment.payment_type_id === "bank_transfer"
        ? "pix"
        : payment.payment_type_id === "debit_card"
          ? "debito"
          : "credito";
    const bruto = Number(payment.transaction_amount || 0);
    const totals = buildTotals(bruto, feePercentForMethod(metodo));

    await markAppointmentPaid(appointmentId, {
      metodo,
      adquirente: "mercado_pago",
      externalId: String(payment.id),
      observacao: "Confirmado via Mercado Pago",
      ...totals,
    });

    res.status(200).send("ok");
  } catch (error) {
    console.error("mercadoPagoWebhook", error);
    res.status(500).send("error");
  }
});
