const STORAGE_KEY = "nailpro-client-cache-v1";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

let db = null;
let docRef = null;
let currentUser = null;
let state = {
  clientes: [],
  servicos: [],
  agendamentos: [],
};
let currentClient = null;
let authMode = "login";

const authPanel = document.querySelector("#authPanel");
const bookingPanel = document.querySelector("#bookingPanel");
const authMessage = document.querySelector("#authMessage");
const bookingMessage = document.querySelector("#bookingMessage");

function isFirebaseConfigured() {
  const config = window.FIREBASE_CONFIG;
  return Boolean(
    window.firebase &&
      config &&
      config.apiKey &&
      config.projectId &&
      !String(config.apiKey).startsWith("YOUR_API_KEY") &&
      !String(config.projectId).startsWith("YOUR_PROJECT_ID"),
  );
}

function init() {
  if (!isFirebaseConfigured()) {
    setAuthMessage("Firebase nao configurado. Configure o Firebase para ativar login e agendamento online.");
    return;
  }
  if (window.location.protocol === "file:") {
    setAuthMessage("Abra esta pagina por http://localhost ou pela hospedagem. O Firebase Auth nao funciona via file://.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.firestore();
  docRef = db.doc(window.FIREBASE_DOC_PATH || "sistemas/firebase");
  firebase.auth().getRedirectResult().catch((error) => {
    console.error(error);
    setAuthMessage(authErrorMessage(error));
  });

  firebase.auth().onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
      showBooking();
      fillProfileFromUser(user);
      subscribeState();
    } else {
      currentClient = null;
      showAuth();
    }
  });

  bindEvents();
}

function bindEvents() {
  document.querySelector("#googleLogin").addEventListener("click", signInWithGoogle);
  document.querySelector("#emailAuthForm").addEventListener("submit", handleEmailAuth);
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      authMode = button.dataset.authMode;
    });
  });
  document.querySelector("#profileForm").addEventListener("submit", saveClientProfile);
  document.querySelector("#passwordForm").addEventListener("submit", updateClientPassword);
  document.querySelector("#bookingForm").addEventListener("submit", requestAppointment);
  document.querySelector("#bookingService").addEventListener("change", () => {
    updateServiceSummary();
    renderAvailableSlots();
  });
  document.querySelector("#bookingDate").addEventListener("change", renderAvailableSlots);
  document.querySelector("#bookingTime").addEventListener("change", renderAvailableSlots);
  document.querySelector("#logoutButton").addEventListener("click", () => firebase.auth().signOut());
  document.querySelector("#bookingDate").min = new Date().toISOString().slice(0, 10);
}

async function signInWithGoogle() {
  setAuthMessage("");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithRedirect(provider);
  } catch (error) {
    console.error(error);
    setAuthMessage(authErrorMessage(error));
  }
}

async function handleEmailAuth(event) {
  event.preventDefault();
  setAuthMessage("");
  const name = document.querySelector("#authName").value.trim();
  const email = document.querySelector("#authEmail").value.trim();
  const password = document.querySelector("#authPassword").value;
  try {
    if (authMode === "signup") {
      const credential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      if (name) await credential.user.updateProfile({ displayName: name });
    } else {
      await firebase.auth().signInWithEmailAndPassword(email, password);
    }
    document.querySelector("#emailAuthForm").reset();
  } catch (error) {
    console.error(error);
    setAuthMessage(authErrorMessage(error));
  }
}

function authErrorMessage(error) {
  if (error.code === "auth/popup-closed-by-user") return "Login com Google cancelado.";
  if (error.code === "auth/email-already-in-use") return "Este email ja tem cadastro. Use Entrar.";
  if (error.code === "auth/user-not-found") return "Conta nao encontrada. Use Cadastrar.";
  if (error.code === "auth/wrong-password") return "Senha incorreta.";
  if (error.code === "auth/weak-password") return "A senha precisa ter pelo menos 6 caracteres.";
  if (error.code === "auth/configuration-not-found") return "Habilite Email/Senha e Google no Firebase Authentication.";
  if (error.code === "auth/requires-recent-login") return "Entre novamente e tente trocar a senha de novo.";
  return error.message || "Nao foi possivel autenticar.";
}

function subscribeState() {
  docRef.onSnapshot(
    (snapshot) => {
      const remoteState = snapshot.data()?.state || {};
      state = {
        clientes: Array.isArray(remoteState.clientes) ? remoteState.clientes : [],
        servicos: Array.isArray(remoteState.servicos) ? remoteState.servicos : [],
        agendamentos: Array.isArray(remoteState.agendamentos) ? remoteState.agendamentos : [],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncClientFromState();
      renderServices();
      renderAvailableSlots();
      renderClientAppointments();
    },
    (error) => {
      console.error(error);
      toast("Nao foi possivel sincronizar os dados.");
    },
  );
}

function showAuth() {
  authPanel.classList.remove("hidden");
  bookingPanel.classList.add("hidden");
}

function showBooking() {
  authPanel.classList.add("hidden");
  bookingPanel.classList.remove("hidden");
}

function fillProfileFromUser(user) {
  document.querySelector("#clientName").value = user.displayName || "";
  document.querySelector("#clientEmail").value = user.email || "";
}

function syncClientFromState() {
  if (!currentUser) return;
  currentClient =
    state.clientes.find((client) => client.authUid === currentUser.uid) ||
    state.clientes.find((client) => client.email && currentUser.email && client.email.toLowerCase() === currentUser.email.toLowerCase()) ||
    null;

  if (currentClient) {
    document.querySelector("#clientName").value = currentClient.nome || currentUser.displayName || "";
    document.querySelector("#clientPhone").value = currentClient.telefone || "";
    document.querySelector("#clientEmail").value = currentClient.email || currentUser.email || "";
  }
}

async function saveClientProfile(event) {
  event.preventDefault();
  if (!currentUser) return;
  const name = document.querySelector("#clientName").value.trim();
  const phone = document.querySelector("#clientPhone").value.trim();
  if (!name || !phone) {
    toast("Informe nome e telefone.");
    return;
  }

  try {
    await upsertClientProfile({ name, phone });
    toast("Dados salvos.");
  } catch (error) {
    console.error(error);
    toast("Nao foi possivel salvar seus dados.");
  }
}

async function updateClientPassword(event) {
  event.preventDefault();
  if (!currentUser) return;
  const currentPassword = document.querySelector("#currentPassword").value;
  const newPassword = document.querySelector("#newPassword").value;
  const hasPasswordProvider = currentUser.providerData.some((provider) => provider.providerId === "password");
  if (!hasPasswordProvider) {
    toast("Sua conta entrou pelo Google. A senha deve ser alterada na sua conta Google.");
    return;
  }
  if (!currentPassword || !newPassword) return toast("Informe a senha atual e a nova senha.");
  if (newPassword.length < 6) return toast("A nova senha precisa ter pelo menos 6 caracteres.");

  try {
    const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
    await currentUser.reauthenticateWithCredential(credential);
    await currentUser.updatePassword(newPassword);
    document.querySelector("#passwordForm").reset();
    toast("Senha atualizada.");
  } catch (error) {
    console.error(error);
    toast(authErrorMessage(error));
  }
}

async function upsertClientProfile({ name, phone }) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const data = snapshot.data() || {};
    const nextState = normalizeState(data.state || {});
    const now = new Date().toISOString();
    let client =
      nextState.clientes.find((item) => item.authUid === currentUser.uid) ||
      nextState.clientes.find((item) => item.email && currentUser.email && item.email.toLowerCase() === currentUser.email.toLowerCase());

    if (client) {
      client.nome = name;
      client.telefone = phone;
      client.email = currentUser.email || client.email || "";
      client.authUid = currentUser.uid;
      client.clienteAtivo = true;
      client.atualizadoEm = now;
      nextState.agendamentos
        .filter((appointment) => appointment.clienteId === client.id)
        .forEach((appointment) => {
          appointment.nomeCliente = client.nome;
          appointment.telefone = client.telefone;
        });
    } else {
      client = {
        id: id(),
        nome: name,
        telefone: phone,
        email: currentUser.email || "",
        authUid: currentUser.uid,
        observacoes: "Cadastro realizado pela area da cliente.",
        clienteAtivo: true,
        dataCadastro: now,
      };
      nextState.clientes.push(client);
    }

    transaction.set(docRef, { state: nextState, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

function renderServices() {
  const select = document.querySelector("#bookingService");
  const selectedServiceId = select.value;
  const services = activeServices();
  select.innerHTML = services.length
    ? `<option value="">Selecione um servico</option>` +
      services
        .map((service) => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.nome)} - ${money(service.valorPadrao)}</option>`)
        .join("")
    : `<option value="">Nenhum servico disponivel</option>`;
  if (services.some((service) => service.id === selectedServiceId)) {
    select.value = selectedServiceId;
  }
  updateServiceSummary();
}

function activeServices() {
  return state.servicos
    .filter((service) => service.ativo !== false)
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
}

function updateServiceSummary() {
  const service = state.servicos.find((item) => item.id === document.querySelector("#bookingService").value);
  const summary = document.querySelector("#serviceSummary");
  if (!service) {
    summary.textContent = "Escolha um servico para ver valor e duracao.";
    return;
  }
  summary.textContent = `${service.nome} · ${money(service.valorPadrao)} · duracao aproximada de ${Number(service.duracaoMinutos || 60)} minutos.`;
}

function renderAvailableSlots() {
  const slotsEl = document.querySelector("#availableSlots");
  const service = state.servicos.find((item) => item.id === document.querySelector("#bookingService").value && item.ativo !== false);
  const date = document.querySelector("#bookingDate").value;
  const selectedTime = document.querySelector("#bookingTime").value;

  if (!service || !date) {
    slotsEl.innerHTML = `<strong>Horarios disponiveis</strong><span class="muted">Escolha um servico e uma data para ver sugestoes de horario.</span>`;
    return;
  }

  const slots = getAvailableSlots(date, Number(service.duracaoMinutos || 60));
  if (!slots.length) {
    slotsEl.innerHTML = `<strong>Horarios disponiveis</strong><span class="muted">Nao encontrei horarios livres nessa data para a duracao do servico.</span>`;
    return;
  }

  slotsEl.innerHTML = `<strong>Horarios disponiveis</strong><div class="slot-grid">
    ${slots
      .map(
        (time) =>
          `<button class="slot-button ${time === selectedTime ? "active" : ""}" type="button" data-slot-time="${time}">${time}</button>`,
      )
      .join("")}
  </div>`;
  slotsEl.querySelectorAll("[data-slot-time]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#bookingTime").value = button.dataset.slotTime;
      renderAvailableSlots();
    });
  });
}

function getAvailableSlots(date, durationMinutes) {
  const slots = [];
  const openingHour = 8;
  const closingHour = 19;
  const stepMinutes = 30;
  const now = new Date();
  const dayStart = new Date(`${date}T${String(openingHour).padStart(2, "0")}:00`);
  const dayEnd = new Date(`${date}T${String(closingHour).padStart(2, "0")}:00`);

  for (let start = new Date(dayStart); start.getTime() + durationMinutes * 60000 <= dayEnd.getTime(); start = new Date(start.getTime() + stepMinutes * 60000)) {
    if (start < now) continue;
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const candidate = {
      id: "candidate",
      dataHoraInicio: toDateTimeInput(start),
      dataHoraFim: toDateTimeInput(end),
      status: "Pendente confirmação",
    };
    if (!getScheduleConflict(state.agendamentos, candidate)) {
      slots.push(toTimeInput(start));
    }
  }
  return slots;
}

async function requestAppointment(event) {
  event.preventDefault();
  if (!currentUser) return;

  const name = document.querySelector("#clientName").value.trim();
  const phone = document.querySelector("#clientPhone").value.trim();
  const serviceId = document.querySelector("#bookingService").value;
  const service = state.servicos.find((item) => item.id === serviceId && item.ativo !== false);
  const date = document.querySelector("#bookingDate").value;
  const time = document.querySelector("#bookingTime").value;
  const notes = document.querySelector("#bookingNotes").value.trim();
  if (!name || !phone) return toast("Salve seu nome e telefone antes de agendar.");
  if (!service) return toast("Selecione um servico ativo.");
  if (!date || !time) return toast("Escolha data e horario.");

  const start = new Date(`${date}T${time}`);
  if (Number.isNaN(start.getTime()) || start < new Date()) return toast("Escolha um horario futuro.");
  const end = new Date(start.getTime() + Number(service.duracaoMinutos || 60) * 60000);

  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      const data = snapshot.data() || {};
      const nextState = normalizeState(data.state || {});
      let client =
        nextState.clientes.find((item) => item.authUid === currentUser.uid) ||
        nextState.clientes.find((item) => item.email && currentUser.email && item.email.toLowerCase() === currentUser.email.toLowerCase());
      const now = new Date().toISOString();

      if (client) {
        client.nome = name;
        client.telefone = phone;
        client.email = currentUser.email || client.email || "";
        client.authUid = currentUser.uid;
        client.clienteAtivo = true;
      } else {
        client = {
          id: id(),
          nome: name,
          telefone: phone,
          email: currentUser.email || "",
          authUid: currentUser.uid,
          observacoes: "Cadastro realizado pela area da cliente.",
          clienteAtivo: true,
          dataCadastro: now,
        };
        nextState.clientes.push(client);
      }

      const appointment = {
        id: id(),
        clienteId: client.id,
        clienteAuthUid: currentUser.uid,
        origemCliente: true,
        nomeCliente: client.nome,
        telefone: client.telefone,
        emailCliente: currentUser.email || "",
        servicoId: service.id,
        nomeServico: service.nome,
        servicoId2: "",
        nomeServico2: "",
        valorServico: Number(service.valorPadrao || 0),
        descontoTipo: "nenhum",
        descontoValor: 0,
        valorFinal: Number(service.valorPadrao || 0),
        dataHoraInicio: toDateTimeInput(start),
        dataHoraFim: toDateTimeInput(end),
        status: "Pendente confirmação",
        observacoes: notes,
        usarPacote: false,
        pacoteId: "",
        servicoCreditoPacoteId: "",
        tipoCreditoPacote: "",
        formaPagamento: "",
        statusPagamento: "pendente",
        taxaPercentual: 0,
        valorTaxa: 0,
        descontoPagamentoTipo: "nenhum",
        descontoPagamentoValor: 0,
        valorDescontoPagamento: 0,
        valorBruto: Number(service.valorPadrao || 0),
        valorLiquido: Number(service.valorPadrao || 0),
        dataPagamento: "",
        observacoesPagamento: "",
        financeiroGerado: false,
        dataCadastro: now,
      };

      const conflict = getScheduleConflict(nextState.agendamentos, appointment);
      if (conflict) throw new Error("Este horario ja esta ocupado. Escolha outro horario.");
      nextState.agendamentos.push(appointment);
      transaction.set(docRef, { state: nextState, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });

    document.querySelector("#bookingForm").reset();
    updateServiceSummary();
    renderAvailableSlots();
    toast("Solicitacao enviada. Aguarde a confirmacao.");
  } catch (error) {
    console.error(error);
    toast(error.message || "Nao foi possivel solicitar o agendamento.");
  }
}

function renderClientAppointments() {
  const list = document.querySelector("#clientAppointments");
  if (!currentUser) return;
  const appointments = state.agendamentos
    .filter((appointment) => appointment.clienteAuthUid === currentUser.uid || appointment.clienteId === currentClient?.id)
    .sort((a, b) => b.dataHoraInicio.localeCompare(a.dataHoraInicio));

  if (!appointments.length) {
    list.innerHTML = `<div class="service-summary">Suas solicitacoes aparecerão aqui.</div>`;
    return;
  }

  list.innerHTML = appointments
    .map((appointment) => {
      const start = new Date(appointment.dataHoraInicio);
      const end = new Date(appointment.dataHoraFim);
      return `<article class="booking-card">
        <strong>${escapeHtml(appointment.nomeServico || "Servico")}</strong>
        <span>${start.toLocaleDateString("pt-BR")} · ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="muted">${money(appointment.valorFinal || 0)}</span>
        <span class="badge ${statusClass(appointment.status)}">${escapeHtml(appointment.status)}</span>
      </article>`;
    })
    .join("");
}

function normalizeState(remoteState) {
  return {
    ...remoteState,
    clientes: Array.isArray(remoteState.clientes) ? remoteState.clientes : [],
    servicos: Array.isArray(remoteState.servicos) ? remoteState.servicos : [],
    agendamentos: Array.isArray(remoteState.agendamentos) ? remoteState.agendamentos : [],
    pacotes: Array.isArray(remoteState.pacotes) ? remoteState.pacotes : [],
    financeiro: Array.isArray(remoteState.financeiro) ? remoteState.financeiro : [],
    settings: remoteState.settings || {},
  };
}

function getScheduleConflict(appointments, candidate) {
  const start = new Date(candidate.dataHoraInicio).getTime();
  const end = new Date(candidate.dataHoraFim).getTime();
  return appointments
    .filter((item) => item.status !== "Cancelado")
    .find((item) => {
      const itemStart = new Date(item.dataHoraInicio).getTime();
      const itemEnd = new Date(item.dataHoraFim).getTime();
      return start < itemEnd && end > itemStart;
    });
}

function setAuthMessage(message) {
  authMessage.textContent = message;
}

function toast(message) {
  const toastEl = document.querySelector("#toast");
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

function money(value) {
  return currency.format(Number(value || 0));
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function toDateTimeInput(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toTimeInput(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusClass(status) {
  return String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();
