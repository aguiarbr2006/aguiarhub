// Chave usada para guardar uma cópia simples dos dados no navegador.
// Isso ajuda a manter uma referência local do último estado recebido do Firebase.
const STORAGE_KEY = "nailpro-client-cache-v1";

// Formatador de moeda em real brasileiro.
// Sempre que o sistema mostrar valores, usamos essa configuração.
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Variáveis principais da conexão com Firebase e do usuário logado.
let db = null;
let docRef = null;
let currentUser = null;

// Estado principal da página da cliente.
// Ele recebe os dados que vêm do Firestore: clientes, serviços,
// agendamentos, configurações e conteúdo do site público.
let state = {
  clientes: [],
  servicos: [],
  agendamentos: [],
  settings: {},
  landingContent: {},
};
let currentClient = null;
let authMode = "login";

// Elementos principais da tela.
// Guardar essas referências evita procurar os mesmos elementos várias vezes.
const authPanel = document.querySelector("#authPanel");
const bookingPanel = document.querySelector("#bookingPanel");
const authMessage = document.querySelector("#authMessage");
const bookingMessage = document.querySelector("#bookingMessage");

// Confere se o Firebase foi configurado corretamente.
// Se faltar apiKey/projectId, a página mostra uma mensagem em vez de quebrar.
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

// Transforma uma imagem em um valor seguro para usar dentro de background-image no CSS.
// Exemplo final: url("assets/site/hero-placeholder.svg")
function cssImageUrl(src) {
  const fallback = "assets/site/hero-placeholder.svg";
  const value = String(src || fallback).replace(/["\\\n\r]/g, "");
  return `url("${value}")`;
}

// Aplica na página de agendamento a mesma foto de fundo da página principal.
// A foto principal fica salva em landingContent.heroImage, que vem do editor do site.
function applyClientLandingContent(content = {}) {
  document.documentElement.style.setProperty("--client-hero-image", cssImageUrl(content.heroImage));
}

// Função inicial da página.
// Ela valida o Firebase, inicializa a conexão e registra os eventos de login/agendamento.
function init() {
  // Mesmo antes do Firebase responder, já usamos a imagem local padrão.
  applyClientLandingContent();

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
  subscribeState();

  // Escuta o login/logout do Firebase Auth.
  // Quando existe usuário logado, mostramos o painel de agendamento.
  // Quando não existe, mostramos o painel de entrada/cadastro.
  firebase.auth().onAuthStateChanged((user) => {
    currentUser = user;
    if (user) {
      showBooking();
      fillProfileFromUser(user);
    } else {
      currentClient = null;
      showAuth();
    }
  });

  bindEvents();
}

// Liga os cliques e envios dos formulários às funções JavaScript.
// Esta função concentra os eventos para ficar mais fácil encontrar o que cada botão faz.
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
  document.querySelector("#logoutButton").addEventListener("click", () => firebase.auth().signOut());
  document.querySelector("#bookingDate").min = new Date().toISOString().slice(0, 10);
  document.querySelector("#closeBookingDialog")?.addEventListener("click", () => {
    document.querySelector("#bookingConfirmDialog").close();
  });
}

// Login com Google usando o popup padrão do Firebase Auth.
async function signInWithGoogle() {
  setAuthMessage("");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  } catch (error) {
    console.error(error);
    setAuthMessage(authErrorMessage(error));
  }
}

// Trata login e cadastro por email/senha.
// O botão clicado define authMode: "login" para entrar ou "signup" para cadastrar.
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

// Traduz alguns erros comuns do Firebase para mensagens mais amigáveis em português.
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

// Escuta em tempo real o documento principal do Firestore.
// Quando o sistema administrativo altera dados, esta página recebe a atualização.
function subscribeState() {
  docRef.onSnapshot(
    (snapshot) => {
      const remoteState = snapshot.data()?.state || {};
      state = {
        clientes: Array.isArray(remoteState.clientes) ? remoteState.clientes : [],
        servicos: Array.isArray(remoteState.servicos) ? remoteState.servicos : [],
        agendamentos: Array.isArray(remoteState.agendamentos) ? remoteState.agendamentos : [],
        settings: remoteState.settings || {},
        landingContent: remoteState.landingContent || {},
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyClientLandingContent(state.landingContent);
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

// Mostra o formulário de login/cadastro e esconde o painel de agendamento.
function showAuth() {
  authPanel.classList.remove("hidden");
  bookingPanel.classList.add("hidden");
}

// Mostra o painel de agendamento e esconde o formulário de login/cadastro.
function showBooking() {
  authPanel.classList.add("hidden");
  bookingPanel.classList.remove("hidden");
}

// Preenche os campos de nome/email com os dados básicos do usuário logado.
function fillProfileFromUser(user) {
  document.querySelector("#clientName").value = user.displayName || "";
  document.querySelector("#clientEmail").value = user.email || "";
}

// Procura no estado do sistema qual cliente corresponde ao usuário logado.
// A busca tenta primeiro pelo authUid e depois pelo email.
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

// Salva ou atualiza os dados de contato da cliente no Firestore.
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

// Permite trocar a senha quando a conta foi criada por email/senha.
// Contas Google precisam alterar a senha diretamente na conta Google.
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

// Cria ou atualiza o cadastro da cliente dentro do documento principal.
// Usamos transação para ler o estado atual, alterar com segurança e salvar de volta.
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

// Renderiza a lista de serviços ativos no campo de seleção.
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

// Retorna apenas serviços ativos e ordenados pelo nome.
function activeServices() {
  return state.servicos
    .filter((service) => service.ativo !== false)
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
}

// Mostra um resumo do serviço escolhido: nome, valor e duração aproximada.
function updateServiceSummary() {
  const service = state.servicos.find((item) => item.id === document.querySelector("#bookingService").value);
  const summary = document.querySelector("#serviceSummary");
  if (!service) {
    summary.textContent = "Escolha um servico para ver valor e duracao.";
    return;
  }
  summary.textContent = `${service.nome} · ${money(service.valorPadrao)} · duracao aproximada de ${Number(service.duracaoMinutos || 60)} minutos.`;
}

// Calcula e mostra os horários livres para o serviço e a data escolhidos.
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

  slotsEl.innerHTML = `<strong>Horarios disponiveis — clique para selecionar</strong><div class="slot-grid">
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

// Gera sugestões de horários a cada 30 minutos e remove horários que já têm conflito.
function getAvailableSlots(date, durationMinutes) {
  const slots = [];
  const settings = state.settings || {};
  const openingTime = settings.openingTime || "08:00";
  const closingTime = settings.closingTime || "19:00";
  const lunchStart = settings.lunchStart || "12:00";
  const lunchEnd = settings.lunchEnd || "13:00";
  const stepMinutes = 30;
  
  const now = new Date();
  const dayStart = new Date(`${date}T${openingTime}`);
  const dayEnd = new Date(`${date}T${closingTime}`);
  const lunchStartTime = new Date(`${date}T${lunchStart}`).getTime();
  const lunchEndTime = new Date(`${date}T${lunchEnd}`).getTime();

  for (let start = new Date(dayStart); start.getTime() + durationMinutes * 60000 <= dayEnd.getTime(); start = new Date(start.getTime() + stepMinutes * 60000)) {
    if (start < now) continue;
    
    const startTime = start.getTime();
    const endTime = startTime + durationMinutes * 60000;
    
    // Verificar conflito com horário de almoço
    // Se o atendimento começar ou terminar dentro do almoço, ou englobar o almoço
    if (startTime < lunchEndTime && endTime > lunchStartTime) {
      continue;
    }

    const candidate = {
      id: "candidate",
      dataHoraInicio: toDateTimeInput(start),
      dataHoraFim: toDateTimeInput(new Date(endTime)),
      status: "Pendente confirmação",
    };
    if (!getScheduleConflict(state.agendamentos, candidate)) {
      slots.push(toTimeInput(start));
    }
  }
  return slots;
}

// Envia a solicitação de agendamento.
// Antes de salvar, valida dados da cliente, serviço, data, horário e conflitos.
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
  if (!date) return toast("Escolha uma data.");
  if (!time) return toast("Selecione um horario disponivel clicando nos botoes acima.");

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

    // Mostrar dialog de confirmação com botão WhatsApp (após transação bem-sucedida)
    showBookingConfirmDialog({
      clientName: document.querySelector("#clientName").value.trim(),
      serviceName: service.nome,
      date,
      time,
      endTime: toTimeInput(end),
      value: service.valorPadrao,
      notes,
    });

    document.querySelector("#bookingForm").reset();
    document.querySelector("#bookingTime").value = "";
    updateServiceSummary();
    renderAvailableSlots();
  } catch (error) {
    console.error(error);
    toast(error.message || "Nao foi possivel solicitar o agendamento.");
  }
}

// Depois que o agendamento é criado, mostra um resumo e monta o link do WhatsApp.
function showBookingConfirmDialog({ clientName, serviceName, date, time, endTime, value, notes }) {
  const dialog = document.querySelector("#bookingConfirmDialog");
  if (!dialog) return;

  const dateFormatted = new Date(`${date}T00:00`).toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  document.querySelector("#dialogDetails").innerHTML = `
    <div class="dialog-detail-row"><span>Serviço</span><strong>${escapeHtml(serviceName)}</strong></div>
    <div class="dialog-detail-row"><span>Data</span><strong>${dateFormatted}</strong></div>
    <div class="dialog-detail-row"><span>Horário</span><strong>${time} às ${endTime}</strong></div>
    <div class="dialog-detail-row"><span>Valor</span><strong>${money(value)}</strong></div>
    ${notes ? `<div class="dialog-detail-row"><span>Obs.</span><strong>${escapeHtml(notes)}</strong></div>` : ""}
  `;

  // Montar link WhatsApp com telefone da empresa
  const companyPhone = (state.settings?.telefoneContato || "").replace(/\D/g, "");
  const whatsappBtn = document.querySelector("#dialogWhatsapp");
  if (companyPhone) {
    const waPhone = companyPhone.startsWith("55") ? companyPhone : `55${companyPhone}`;
    const msg = [
      `Olá! Gostaria de confirmar meu agendamento:`,
      ``,
      `👤 Nome: ${clientName}`,
      `💅 Serviço: ${serviceName}`,
      `📅 Data: ${dateFormatted}`,
      `🕐 Horário: ${time} às ${endTime}`,
      `💰 Valor: ${money(value)}`,
      notes ? `📝 Obs.: ${notes}` : "",
    ].filter(Boolean).join("\n");
    whatsappBtn.href = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
    whatsappBtn.style.display = "inline-flex";
  } else {
    whatsappBtn.style.display = "none";
  }

  dialog.showModal();
}

// Lista os agendamentos da cliente logada e mostra o status de cada um.
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

// Garante que o estado recebido do Firestore tenha arrays e objetos válidos.
// Isso evita erro caso alguma parte ainda não exista no banco.
function normalizeState(remoteState) {
  return {
    ...remoteState,
    clientes: Array.isArray(remoteState.clientes) ? remoteState.clientes : [],
    servicos: Array.isArray(remoteState.servicos) ? remoteState.servicos : [],
    agendamentos: Array.isArray(remoteState.agendamentos) ? remoteState.agendamentos : [],
    pacotes: Array.isArray(remoteState.pacotes) ? remoteState.pacotes : [],
    financeiro: Array.isArray(remoteState.financeiro) ? remoteState.financeiro : [],
    settings: remoteState.settings || {},
    landingContent: remoteState.landingContent || {},
  };
}

// Verifica se um agendamento candidato entra em conflito com outro já existente.
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

// Mostra mensagens no painel de autenticação.
function setAuthMessage(message) {
  authMessage.textContent = message;
}

// Mostra uma mensagem temporária no rodapé da tela.
function toast(message) {
  const toastEl = document.querySelector("#toast");
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

// Formata números como moeda brasileira.
function money(value) {
  return currency.format(Number(value || 0));
}

// Cria um id único para novos clientes/agendamentos.
function id() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// Converte um objeto Date para o formato usado por input datetime-local.
function toDateTimeInput(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Converte um objeto Date para "HH:mm".
function toTimeInput(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Transforma o texto do status em classe CSS.
// Exemplo: "Pendente confirmação" vira "pendente-confirmacao".
function statusClass(status) {
  return String(status || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

// Escapa caracteres especiais para evitar que textos digitados virem HTML indevido.
function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Ponto de entrada: quando o arquivo carrega, iniciamos a página.
init();
