const STORAGE_KEY = "nailpro-state-v1";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const DEFAULT_SETTINGS = {
  companyName: "Rayssa Oliveira",
  subtitle: "Nail designer",
  logoText: "R",
  logoImage: "",
  developerCredit: "Desenvolvido por Rafael Aguiar Ribeiro · Instagram @aguiar.3d",
  colors: {
    green: "#4f7d5a",
    greenDark: "#2f4f3a",
    beige: "#f4efe6",
    ink: "#2b2b2b",
  },
};

function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

const hasSavedState = Boolean(localStorage.getItem(STORAGE_KEY));
const state = loadState();

let remoteDb = null;
let remoteDocRef = null;
let remoteReady = false;
let applyingRemoteState = false;
let pendingRemoteSave = null;
let deferredInstallPrompt = null;
let currentUser = null;
let userPermissions = {};

const pages = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Resumo do seu dia e do financeiro.",
    el: document.querySelector("#dashboardPage"),
  },
  agenda: {
    title: "Agenda",
    subtitle: "Calendário, atendimentos e status.",
    el: document.querySelector("#agendaPage"),
  },
  clientes: {
    title: "Clientes",
    subtitle: "Cadastro, histórico e total gasto.",
    el: document.querySelector("#clientesPage"),
  },
  financeiro: {
    title: "Financeiro",
    subtitle: "Entradas, saídas, lucro e relatórios.",
    el: document.querySelector("#financeiroPage"),
  },
  pacotes: {
    title: "Pacotes",
    subtitle: "Pacotes pre-pagos e creditos disponiveis.",
    el: document.querySelector("#pacotesPage"),
  },
  servicos: {
    title: "Serviços",
    subtitle: "Valores padrão, duração e disponibilidade.",
    el: document.querySelector("#servicosPage"),
  },
  admin: {
    title: "Administração",
    subtitle: "Nome, logo e cores do sistema.",
    el: document.querySelector("#adminPage"),
  },
  funcionarios: {
    title: "Funcionários",
    subtitle: "Gerenciamento de usuários e permissões.",
    el: document.querySelector("#funcionariosPage"),
  },
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);

  const now = new Date();
  const date = toDateInput(now);
  const start = `${date}T10:00`;
  const end = `${date}T11:30`;

  return {
    settings: defaultSettings(),
    clientes: [
      {
        id: id(),
        nome: "Marina Souza",
        telefone: "(11) 99999-1010",
        observacoes: "Prefere tons nude.",
        dataCadastro: now.toISOString(),
      },
      {
        id: id(),
        nome: "Camila Rocha",
        telefone: "(21) 98888-2020",
        observacoes: "Cliente quinzenal.",
        dataCadastro: now.toISOString(),
      },
    ],
    servicos: [
      {
        id: id(),
        nome: "Alongamento",
        valorPadrao: 160,
        duracaoMinutos: 120,
        ativo: true,
        dataCadastro: now.toISOString(),
      },
      {
        id: id(),
        nome: "Manutenção",
        valorPadrao: 95,
        duracaoMinutos: 90,
        ativo: true,
        dataCadastro: now.toISOString(),
      },
      {
        id: id(),
        nome: "Blindagem",
        valorPadrao: 75,
        duracaoMinutos: 60,
        ativo: true,
        dataCadastro: now.toISOString(),
      },
    ],
    agendamentos: [],
    pacotes: [],
    financeiro: [
      {
        id: id(),
        tipo: "saida",
        descricao: "Reposição de materiais",
        categoria: "Material",
        valor: 80,
        data: date,
        origem: "manual",
        agendamentoId: "",
        dataCadastro: now.toISOString(),
      },
    ],
  };
}

function seedAppointment() {
  if (state.agendamentos.length) return;
  const cliente = state.clientes[0];
  const servico = state.servicos[1];
  const date = toDateInput(new Date());
  state.agendamentos.push({
    id: id(),
    clienteId: cliente.id,
    nomeCliente: cliente.nome,
    telefone: cliente.telefone,
    servicoId: servico.id,
    nomeServico: servico.nome,
    valorServico: servico.valorPadrao,
    descontoTipo: "nenhum",
    descontoValor: 0,
    valorFinal: servico.valorPadrao,
    dataHoraInicio: `${date}T10:00`,
    dataHoraFim: `${date}T11:30`,
    status: "Agendado",
    observacoes: "",
    financeiroGerado: false,
    dataCadastro: new Date().toISOString(),
  });
}

if (!hasSavedState) seedAppointment();
migrateState();
save();

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueRemoteSave();
}

function serializableState() {
  return JSON.parse(JSON.stringify({
    settings: state.settings,
    clientes: state.clientes,
    servicos: state.servicos,
    agendamentos: state.agendamentos,
    pacotes: state.pacotes,
    financeiro: state.financeiro,
  }));
}

function replaceState(nextState) {
  state.settings = nextState.settings || defaultSettings();
  state.clientes = Array.isArray(nextState.clientes) ? nextState.clientes : [];
  state.servicos = Array.isArray(nextState.servicos) ? nextState.servicos : [];
  state.agendamentos = Array.isArray(nextState.agendamentos) ? nextState.agendamentos : [];
  state.pacotes = Array.isArray(nextState.pacotes) ? nextState.pacotes : [];
  state.financeiro = Array.isArray(nextState.financeiro) ? nextState.financeiro : [];
  migrateState();
}

function isFirebaseConfigured() {
  const config = window.RAYSSA_FIREBASE_CONFIG;
  return Boolean(
    window.firebase &&
      config &&
      config.apiKey &&
      config.projectId &&
      !String(config.apiKey).startsWith("YOUR_API_KEY") &&
      !String(config.projectId).startsWith("YOUR_PROJECT_ID")
  );
}

async function initAuth() {
  if (!isFirebaseConfigured()) {
    console.info("Firebase não configurado. Autenticação desabilitada.");
    showApp();
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(window.RAYSSA_FIREBASE_CONFIG);

    if (window.location.protocol === "file:") {
      showLogin();
      setLoginError(
        "O app está sendo executado via file://. Para usar Firebase Auth, rode o app em http://localhost ou publique no Firebase Hosting."
      );
      return;
    }
    
    // Criar conta admin padrão se não existir
    await createDefaultAdminAccount();
    
    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        await loadUserPermissions(user.uid);
        showApp();
        renderAll();
      } else {
        currentUser = null;
        showLogin();
      }
    });
  } catch (error) {
    console.error("Erro ao inicializar autenticação:", error);
    showApp();
  }
}

async function createDefaultAdminAccount() {
  try {
    const adminEmail = "aguiar-br@hotmail.com";
    const adminPassword = "guitarra";
    const adminName = "Administrador";

    // Tentar fazer login com a conta admin para verificar se ela existe
    try {
      await firebase.auth().signInWithEmailAndPassword(adminEmail, adminPassword);
      console.log("Conta admin já existe e está ativa");
      await firebase.auth().signOut(); // Fazer logout para permitir login normal
      return;
    } catch (loginError) {
      if (loginError.code === "auth/user-not-found") {
        console.log("Criando conta admin padrão...");

        const userCredential = await firebase.auth().createUserWithEmailAndPassword(adminEmail, adminPassword);
        const uid = userCredential.user.uid;

        await firebase.firestore().collection("users").doc(uid).set({
          name: adminName,
          username: "admin",
          email: adminEmail,
          permissions: {
            viewDashboard: true,
            viewAgenda: true,
            createClient: true,
            editClient: true,
            createAppointment: true,
            editAppointment: true,
            changeStatus: true,
            viewFinance: true,
            admin: true,
          },
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        console.log("Conta admin criada com sucesso");
        await firebase.auth().signOut();
      } else {
        console.log("Conta admin pode já existir:", loginError.message);
      }
    }
  } catch (error) {
    console.error("Erro ao criar conta admin:", error);
  }
}

async function loadUserPermissions(uid) {
  try {
    if (!remoteDb) remoteDb = firebase.firestore();
    const doc = await remoteDb.collection("users").doc(uid).get();
    if (doc.exists) {
      userPermissions = doc.data().permissions || {};
    } else {
      // Se o documento não existe, é um novo usuário
      userPermissions = {};
    }
  } catch (error) {
    console.error("Erro ao carregar permissões:", error);
    userPermissions = {};
  }
}

function checkPermission(permission) {
  if (!currentUser) return false;
  if (userPermissions.admin) return true;
  return userPermissions[permission] || false;
}

function showLogin() {
  document.querySelector("#appShell").style.display = "none";
  document.querySelector("#loginOverlay").style.display = "flex";
}

function showApp() {
  document.querySelector("#appShell").style.display = "grid";
  document.querySelector("#loginOverlay").style.display = "none";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  return handleLogin();
}

async function handleLogin() {
  const identifier = document.querySelector("#loginIdentifier").value.trim();
  const password = document.querySelector("#loginPassword").value;

  setLoginError("");

  try {
    const email = await resolveLoginEmail(identifier);
    await firebase.auth().signInWithEmailAndPassword(email, password);
    document.querySelector("#loginForm").reset();
  } catch (error) {
    let errorMessage = error.message || "Erro ao fazer login";

    if (error.code === "auth/configuration-not-found") {
      errorMessage = "Firebase Authentication não está habilitado. Acesse o console do Firebase para habilitar.";
    } else if (error.code === "auth/user-not-found") {
      errorMessage = "Usuário não encontrado. Verifique o usuário ou email digitado.";
    } else if (error.code === "auth/wrong-password") {
      errorMessage = "Senha incorreta. Tente novamente.";
    } else if (error.code === "auth/invalid-email") {
      errorMessage = "Email inválido. Verifique o formato.";
    }

    setLoginError(errorMessage);
  }
}

async function resolveLoginEmail(identifier) {
  if (identifier.includes("@")) {
    return identifier;
  }

  try {
    if (!remoteDb) remoteDb = firebase.firestore();
    
    // First try username
    let snapshot = await remoteDb.collection("users").where("username", "==", identifier).limit(1).get();
    if (!snapshot.empty) {
      return snapshot.docs[0].data().email;
    }
    
    // Then try name
    snapshot = await remoteDb.collection("users").where("name", "==", identifier).limit(1).get();
    if (!snapshot.empty) {
      return snapshot.docs[0].data().email;
    }
    
    throw new Error("Usuário não encontrado");
  } catch (error) {
    throw { code: "auth/user-not-found", message: "Usuário não encontrado." };
  }
}



function setLoginError(message) {
  const errorDiv = document.querySelector("#loginError");
  if (!errorDiv) return;
  errorDiv.textContent = message;
  if (message) {
    errorDiv.classList.add("show");
  } else {
    errorDiv.classList.remove("show");
  }
}

async function handleLogout() {
  try {
    await firebase.auth().signOut();
    currentUser = null;
    userPermissions = {};
    showLogin();
  } catch (error) {
    console.error("Erro ao fazer logout:", error);
    toast("Erro ao fazer logout");
  }
}

function initRemoteSync() {
  if (!isFirebaseConfigured()) {
    console.info("Firebase não configurado. Usando armazenamento local deste navegador.");
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(window.RAYSSA_FIREBASE_CONFIG);
    remoteDb = firebase.firestore();
    remoteDocRef = remoteDb.doc(window.RAYSSA_FIREBASE_DOC_PATH || "sistemas/rayssa-oliveira");

    remoteDocRef.onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) {
          remoteReady = true;
          queueRemoteSave(true);
          return;
        }

        const data = snapshot.data();
        if (!data?.state) return;
        applyingRemoteState = true;
        replaceState(data.state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        applyingRemoteState = false;
        remoteReady = true;
        renderAll();
      },
      (error) => {
        console.error("Erro ao sincronizar Firebase:", error);
        toast("Não foi possível sincronizar com o Firebase.");
      },
    );
  } catch (error) {
    console.error("Erro ao iniciar Firebase:", error);
    toast("Firebase não configurado corretamente.");
  }
}

function queueRemoteSave(force = false) {
  if (!remoteDocRef || applyingRemoteState) return;
  if (!remoteReady && !force) return;
  clearTimeout(pendingRemoteSave);
  pendingRemoteSave = setTimeout(() => {
    remoteDocRef
      .set(
        {
          state: serializableState(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch((error) => {
        console.error("Erro ao salvar no Firebase:", error);
        toast("Não foi possível salvar online.");
      });
  }, force ? 0 : 450);
}

function migrateState() {
  state.settings = {
    ...defaultSettings(),
    ...(state.settings || {}),
    colors: {
      ...DEFAULT_SETTINGS.colors,
      ...(state.settings?.colors || {}),
    },
  };
  state.clientes ||= [];
  state.servicos ||= [];
  state.agendamentos ||= [];
  state.financeiro ||= [];
  state.pacotes ||= [];
  state.pacotes.forEach((pacote) => {
    pacote.peMaoTotal = Number(pacote.peMaoTotal || 0);
    pacote.maoTotal = Number(pacote.maoTotal || 0);
    pacote.peMaoUsado = Number(pacote.peMaoUsado || 0);
    pacote.maoUsado = Number(pacote.maoUsado || 0);
    pacote.status ||= "ativo";
  });
  recomputePackageUsage();
}

function money(value) {
  return currency.format(Number(value || 0));
}

function applySettings() {
  const settings = state.settings;
  document.documentElement.style.setProperty("--green", settings.colors.green);
  document.documentElement.style.setProperty("--green-dark", settings.colors.greenDark);
  document.documentElement.style.setProperty("--beige", settings.colors.beige);
  document.documentElement.style.setProperty("--ink", settings.colors.ink);
  document.title = `${settings.companyName} Gestão`;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", settings.companyName);
  document.querySelector("#developerCredit").textContent = settings.developerCredit;

  document.querySelectorAll(".brand").forEach((brand) => {
    const mark = brand.querySelector(".brand-mark, .brand-logo");
    if (settings.logoImage) {
      const image = document.createElement("img");
      image.className = "brand-logo";
      image.src = settings.logoImage;
      image.alt = settings.companyName;
      mark.replaceWith(image);
    } else {
      const text = document.createElement("span");
      text.className = "brand-mark";
      text.textContent = settings.logoText || settings.companyName.slice(0, 1).toUpperCase();
      mark.replaceWith(text);
    }
    brand.querySelector("strong").textContent = settings.companyName;
    brand.querySelector("small").textContent = settings.subtitle;
  });
  renderAdminSettings();
}

function renderAdminSettings() {
  const form = document.querySelector("#adminForm");
  if (!form) return;
  const settings = state.settings;
  document.querySelector("#settingCompanyName").value = settings.companyName;
  document.querySelector("#settingSubtitle").value = settings.subtitle;
  document.querySelector("#settingLogoText").value = settings.logoText;
  document.querySelector("#settingGreen").value = settings.colors.green;
  document.querySelector("#settingGreenDark").value = settings.colors.greenDark;
  document.querySelector("#settingBeige").value = settings.colors.beige;
  document.querySelector("#settingInk").value = settings.colors.ink;
  document.querySelector("#settingDeveloperCredit").value = settings.developerCredit;
  document.querySelector("#adminNamePreview").textContent = settings.companyName;
  document.querySelector("#adminSubtitlePreview").textContent = settings.subtitle;
  const preview = document.querySelector("#adminLogoPreview");
  if (settings.logoImage) {
    preview.outerHTML = `<img class="brand-logo" id="adminLogoPreview" src="${settings.logoImage}" alt="${escapeHtml(settings.companyName)}" />`;
  } else {
    preview.outerHTML = `<span class="brand-mark" id="adminLogoPreview">${escapeHtml(settings.logoText || "R")}</span>`;
  }
}

function toDateInput(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function toMonthInput(date) {
  return toDateInput(date).slice(0, 7);
}

function toDateTimeInput(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function parseDate(value) {
  return new Date(value);
}

function isSameDay(a, b) {
  return toDateInput(parseDate(a)) === toDateInput(parseDate(b));
}

function inMonth(dateValue, monthValue) {
  return String(dateValue).slice(0, 7) === monthValue;
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

function setPage(pageName) {
  // Check permissions for restricted pages
  if ((pageName === "admin" || pageName === "funcionarios") && !checkPermission("admin")) {
    toast("Acesso negado. Apenas administradores podem acessar esta página.");
    return;
  }
  if (pageName === "financeiro" && !checkPermission("viewFinance")) {
    toast("Acesso negado. Você não tem permissão para acessar o financeiro.");
    return;
  }

  Object.entries(pages).forEach(([key, page]) => {
    page.el.classList.toggle("active", key === pageName);
  });
  document.querySelector("#mobileMoreMenu")?.classList.remove("open");
  document.querySelector("#pageTitle").textContent = pages[pageName].title;
  document.querySelector("#pageSubtitle").textContent = pages[pageName].subtitle;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageName);
  });
}

function calculateFinalValue(price, type, discountValue) {
  const base = Number(price || 0);
  const discount = Number(discountValue || 0);
  if (type === "porcentagem") return Math.max(0, base - base * (discount / 100));
  if (type === "valor") return Math.max(0, base - discount);
  return base;
}

function getSelectedService() {
  return state.servicos.find((service) => service.id === document.querySelector("#appointmentService").value);
}

function getSelectedService2() {
  return state.servicos.find((service) => service.id === document.querySelector("#appointmentService2").value);
}

function getSelectedServices() {
  return [getSelectedService(), getSelectedService2()].filter(Boolean);
}

function updateAppointmentEndFromService() {
  const services = getSelectedServices();
  const startValue = document.querySelector("#appointmentStart").value;
  if (!services.length || !startValue) return;
  const start = parseDate(startValue);
  const duration = services.reduce((total, service) => total + Number(service.duracaoMinutos || 0), 0);
  const end = new Date(start.getTime() + duration * 60000);
  document.querySelector("#appointmentEnd").value = toDateTimeInput(end);
}

function updateAppointmentPriceFromServices() {
  const services = getSelectedServices();
  const total = services.reduce((sum, service) => sum + Number(service.valorPadrao || 0), 0);
  document.querySelector("#appointmentPrice").value = total || "";
  updateAppointmentEndFromService();
  updateFinalPreview();
}

function appointmentServiceName(appointment) {
  const serviceName = [appointment.nomeServico, appointment.nomeServico2].filter(Boolean).join(" + ");
  if (serviceName) return serviceName;
  if (appointment.usarPacote) return packageCreditLabel(appointment.tipoCreditoPacote);
  return "Serviço não informado";
}

function packageCreditLabel(type) {
  return type === "mao" ? "Mão" : "Pé e mão";
}

function packageRemaining(pacote, type) {
  if (type === "mao") return Number(pacote.maoTotal || 0) - Number(pacote.maoUsado || 0);
  return Number(pacote.peMaoTotal || 0) - Number(pacote.peMaoUsado || 0);
}

function recomputePackageUsage() {
  if (!state.pacotes) return;
  state.pacotes.forEach((pacote) => {
    pacote.peMaoUsado = 0;
    pacote.maoUsado = 0;
  });
  state.agendamentos
    .filter((appointment) => appointment.status === "Concluído" && appointment.usarPacote && appointment.pacoteId)
    .forEach((appointment) => {
      const pacote = state.pacotes.find((item) => item.id === appointment.pacoteId);
      if (!pacote) return;
      if (appointment.tipoCreditoPacote === "mao") pacote.maoUsado += 1;
      else pacote.peMaoUsado += 1;
    });
  state.pacotes.forEach((pacote) => {
    const finished = packageRemaining(pacote, "peMao") <= 0 && packageRemaining(pacote, "mao") <= 0;
    pacote.status = finished ? "finalizado" : "ativo";
  });
}

function packageAvailability(pacoteId, type, appointmentId = "") {
  const pacote = state.pacotes.find((item) => item.id === pacoteId);
  if (!pacote) return 0;
  const usedByOthers = state.agendamentos.filter(
    (appointment) =>
      appointment.id !== appointmentId &&
      appointment.status === "Concluído" &&
      appointment.usarPacote &&
      appointment.pacoteId === pacoteId &&
      appointment.tipoCreditoPacote === type,
  ).length;
  const total = type === "mao" ? Number(pacote.maoTotal || 0) : Number(pacote.peMaoTotal || 0);
  return total - usedByOthers;
}

function syncPackageFinance(pacote) {
  const existing = state.financeiro.find((entry) => entry.origem === "pacote" && entry.pacoteId === pacote.id);
  const payload = {
    tipo: "entrada",
    descricao: `Pacote - ${pacote.nome} - ${pacote.nomeCliente}`,
    categoria: "Pacote",
    valor: Number(pacote.valorPago || 0),
    data: toDateInput(pacote.dataCompra || new Date()),
    origem: "pacote",
    pacoteId: pacote.id,
    agendamentoId: "",
  };
  if (existing) Object.assign(existing, payload);
  else {
    state.financeiro.push({
      id: id(),
      ...payload,
      dataCadastro: new Date().toISOString(),
    });
  }
}

let lastConflictSuggestion = null;

function getScheduleConflict(candidate) {
  if (candidate.status === "Cancelado") return false;
  const start = parseDate(candidate.dataHoraInicio).getTime();
  const end = parseDate(candidate.dataHoraFim).getTime();
  const conflict = state.agendamentos
    .filter((item) => item.id !== candidate.id && item.status !== "Cancelado")
    .find((item) => {
    const itemStart = parseDate(item.dataHoraInicio).getTime();
    const itemEnd = parseDate(item.dataHoraFim).getTime();
    return start < itemEnd && end > itemStart;
  });
  if (!conflict) return null;
  return {
    appointment: conflict,
    suggestion: getNextAvailableSlot(candidate, conflict),
  };
}

function getNextAvailableSlot(candidate, conflict) {
  const duration = parseDate(candidate.dataHoraFim).getTime() - parseDate(candidate.dataHoraInicio).getTime();
  let suggestedStart = parseDate(conflict.dataHoraFim);
  let suggestedEnd = new Date(suggestedStart.getTime() + duration);
  const appointments = state.agendamentos
    .filter((item) => item.id !== candidate.id && item.status !== "Cancelado")
    .sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));

  let moved = true;
  while (moved) {
    moved = false;
    for (const item of appointments) {
      const itemStart = parseDate(item.dataHoraInicio);
      const itemEnd = parseDate(item.dataHoraFim);
      if (suggestedStart < itemEnd && suggestedEnd > itemStart) {
        suggestedStart = itemEnd;
        suggestedEnd = new Date(suggestedStart.getTime() + duration);
        moved = true;
      }
    }
  }

  return {
    start: suggestedStart,
    end: suggestedEnd,
  };
}

function syncAppointmentFinance(appointment) {
  const existingFinance = state.financeiro.find((entry) => entry.origem === "agendamento" && entry.agendamentoId === appointment.id);

  if (appointment.status !== "Concluído" || appointment.usarPacote) {
    state.financeiro = state.financeiro.filter((entry) => !(entry.origem === "agendamento" && entry.agendamentoId === appointment.id));
    appointment.financeiroGerado = false;
    return existingFinance ? "removed" : "none";
  }

  const payload = {
    tipo: "entrada",
    descricao: `Atendimento - ${appointmentServiceName(appointment)} - ${appointment.nomeCliente}`,
    categoria: "Serviço",
    valor: appointment.valorFinal,
    data: toDateInput(appointment.dataHoraInicio),
    origem: "agendamento",
    agendamentoId: appointment.id,
  };

  if (existingFinance) {
    Object.assign(existingFinance, payload);
    appointment.financeiroGerado = true;
    return "updated";
  }

  state.financeiro.push({
    id: id(),
    ...payload,
    dataCadastro: new Date().toISOString(),
  });
  appointment.financeiroGerado = true;
  return "created";
}

function bindNavigation() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
  document.querySelectorAll("[data-page-jump]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.pageJump));
  });
}

function bindModalClose() {
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
  });
}

function renderAll() {
  applySettings();
  recomputePackageUsage();
  renderDashboard();
  renderAppointments();
  renderClients();
  renderServices();
  renderFinance();
  renderPackages();
  renderEmployees();
  updateNavigationVisibility();
  fillSelects();
}

function updateNavigationVisibility() {
  // Hide admin and funcionarios pages from non-admins
  const adminPages = ["admin", "funcionarios"];
  adminPages.forEach(page => {
    document.querySelectorAll(`[data-page="${page}"]`).forEach(btn => {
      btn.style.display = checkPermission("admin") ? "" : "none";
    });
  });

  // Hide finance page from users without finance permission
  document.querySelectorAll(`[data-page="financeiro"]`).forEach(btn => {
    btn.style.display = checkPermission("viewFinance") ? "" : "none";
  });
}

function renderDashboard() {
  const today = toDateInput(new Date());
  const month = toMonthInput(new Date());
  const incomes = state.financeiro.filter((f) => f.tipo === "entrada");
  const expenses = state.financeiro.filter((f) => f.tipo === "saida");
  const todayRevenue = sum(incomes.filter((f) => f.data === today));
  const monthRevenue = sum(incomes.filter((f) => inMonth(f.data, month)));
  const monthExpenses = sum(expenses.filter((f) => inMonth(f.data, month)));
  document.querySelector("#todayRevenue").textContent = money(todayRevenue);
  document.querySelector("#monthRevenue").textContent = money(monthRevenue);
  document.querySelector("#monthExpenses").textContent = money(monthExpenses);
  document.querySelector("#monthProfit").textContent = money(monthRevenue - monthExpenses);

  renderRevenueChart();
  renderServiceRanking();
  renderMonthCalendar();

  const todayAppointments = state.agendamentos
    .filter((a) => toDateInput(a.dataHoraInicio) === today)
    .sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));
  document.querySelector("#todayAppointments").innerHTML = todayAppointments.length
    ? todayAppointments.map(appointmentCard).join("")
    : empty("Nenhum agendamento para hoje.");
}

function renderMonthCalendar() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const gridEnd = new Date(lastDay);
  gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
  const today = toDateInput(new Date());
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
  const days = Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });

  document.querySelector("#monthCalendar").innerHTML = days
    .map((date, index) => {
      const key = toDateInput(date);
      const outside = date.getMonth() !== now.getMonth();
      const appointments = state.agendamentos
        .filter((appointment) => toDateInput(appointment.dataHoraInicio) === key)
        .sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));
      return `
        <article class="month-day ${key === today ? "today" : ""} ${outside ? "outside" : ""}">
          <header>${dayNames[date.getDay()]}<small>${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</small></header>
          <div class="month-slots">
            ${
              appointments.length
                ? appointments.map(monthEvent).join("")
                : `<div class="muted">Livre</div>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function monthEvent(appointment) {
  const start = parseDate(appointment.dataHoraInicio);
  const end = parseDate(appointment.dataHoraFim);
  return `
    <button class="month-event" data-edit-appointment="${appointment.id}">
      <strong>${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
      <span>${escapeHtml(appointment.nomeCliente)}</span>
      <small>${escapeHtml(appointmentServiceName(appointment))}</small>
    </button>
  `;
}

function renderRevenueChart() {
  const periodValue = document.querySelector("#dashboardPeriod").value || "30";
  const now = new Date();
  const data = [];
  const dates = [];

  if (periodValue === "currentMonth") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = now.getDate();
    for (let i = 0; i < daysInMonth; i++) {
      const date = new Date(monthStart);
      date.setDate(monthStart.getDate() + i);
      dates.push(date);
    }
  } else {
    const days = Number(periodValue);
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      dates.push(date);
    }
  }

  dates.forEach((date) => {
    const key = toDateInput(date);
    const total = sum(state.financeiro.filter((f) => f.tipo === "entrada" && f.data === key));
    data.push({ key, total });
  });

  const max = Math.max(...data.map((d) => d.total), 1);
  document.querySelector("#revenueChart").innerHTML = data
    .map((d) => {
      const height = Math.max(3, (d.total / max) * 100);
      return `<div class="bar" title="${d.key}: ${money(d.total)}" style="height:${height}%"><small>${d.key.slice(8)}</small></div>`;
    })
    .join("");
}

function renderServiceRanking() {
  const counts = {};
  state.agendamentos
    .filter((a) => a.status === "Concluído")
    .forEach((a) => {
      [a.nomeServico, a.nomeServico2].filter(Boolean).forEach((serviceName) => {
        counts[serviceName] = (counts[serviceName] || 0) + 1;
      });
    });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map(([, value]) => value), 1);
  document.querySelector("#serviceRanking").innerHTML = rows.length
    ? rows
        .map(
          ([name, count]) =>
            `<div class="rank-line"><span>${escapeHtml(name)} <span>${count}</span></span><div><i style="width:${(count / max) * 100}%"></i></div></div>`,
        )
        .join("")
    : empty("Os serviços concluídos aparecerão aqui.");
}

function renderAppointments() {
  const monthInput = document.querySelector("#agendaMonth").value; // formato: "2026-05"
  const status = document.querySelector("#agendaStatus").value;
  const search = normalize(document.querySelector("#agendaSearch").value);

  // Filtrar agendamentos do mês
  const filtered = state.agendamentos
    .filter((a) => {
      if (!monthInput) return true;
      const appointmentMonth = toDateInput(a.dataHoraInicio).slice(0, 7); // "YYYY-MM"
      return appointmentMonth === monthInput;
    })
    .filter((a) => status === "todos" || a.status === status)
    .filter((a) => !search || normalize(`${a.nomeCliente} ${appointmentServiceName(a)} ${a.telefone}`).includes(search))
    .sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));

  // Agrupar por data
  const grouped = {};
  filtered.forEach((appointment) => {
    const date = toDateInput(appointment.dataHoraInicio);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(appointment);
  });

  // Renderizar agrupado
  if (Object.keys(grouped).length === 0) {
    document.querySelector("#appointmentList").innerHTML = empty("Nenhum agendamento encontrado.");
  } else {
    document.querySelector("#appointmentList").innerHTML = Object.entries(grouped)
      .map(([date, appointments]) => {
        const dateObj = new Date(date + "T00:00");
        const dateHeader = dateObj.toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        return `<div class="appointment-group">
          <h3 class="date-header">${dateHeader}</h3>
          ${appointments.map(appointmentCard).join("")}
        </div>`;
      })
      .join("");
  }

  document.querySelectorAll("[data-status-appointment]").forEach((select) => {
    select.addEventListener("change", () => updateAppointmentStatus(select.dataset.statusAppointment, select.value));
  });
}

function appointmentCard(item) {
  const start = parseDate(item.dataHoraInicio);
  const end = parseDate(item.dataHoraFim);
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(item.nomeCliente)}</h3>
          <div class="muted">${start.toLocaleDateString("pt-BR")} · ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
        </div>
        <span class="badge ${statusClass(item.status)}">${item.status}</span>
      </div>
      <div>${escapeHtml(appointmentServiceName(item))} · <strong>${item.usarPacote ? "Pacote pré-pago" : money(item.valorFinal)}</strong></div>
      ${item.usarPacote ? `<div class="badge">Pacote: ${escapeHtml(packageCreditLabel(item.tipoCreditoPacote))}</div>` : ""}
      <div class="muted">${escapeHtml(item.telefone || "")}</div>
      <div class="actions">
        <button class="ghost-button" data-edit-appointment="${item.id}">Editar</button>
        <button class="ghost-button" data-whatsapp-appointment="${item.id}">WhatsApp</button>
        <select data-status-appointment="${item.id}" aria-label="Alterar status">
          ${["Agendado", "Confirmado", "Concluído", "Cancelado"].map((status) => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>
    </article>
  `;
}

function renderClients() {
  const search = normalize(document.querySelector("#clientSearch").value);
  const filtered = state.clientes
    .filter((c) => !search || normalize(`${c.nome} ${c.telefone}`).includes(search))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  document.querySelector("#clientList").innerHTML = filtered.length
    ? filtered.map(clientCard).join("")
    : empty("Nenhum cliente cadastrado.");
  document.querySelectorAll("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => openClient(button.dataset.editClient));
  });
}

function clientCard(client) {
  const appointments = state.agendamentos.filter((a) => a.clienteId === client.id);
  const completed = appointments.filter((a) => a.status === "Concluído");
  const total = completed.reduce((acc, item) => acc + Number(item.valorFinal || 0), 0);
  const last = appointments.sort((a, b) => b.dataHoraInicio.localeCompare(a.dataHoraInicio))[0];
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(client.nome)}</h3>
          <div class="muted">${escapeHtml(client.telefone)}</div>
        </div>
        <button class="ghost-button" data-edit-client="${client.id}">Editar</button>
      </div>
      <div>Total gasto: <strong>${money(total)}</strong></div>
      <div class="muted">${completed.length} atendimento(s) concluído(s)${last ? ` · último em ${new Date(last.dataHoraInicio).toLocaleDateString("pt-BR")}` : ""}</div>
      ${client.observacoes ? `<div>${escapeHtml(client.observacoes)}</div>` : ""}
    </article>
  `;
}

function renderServices() {
  const search = normalize(document.querySelector("#serviceSearch").value);
  const filtered = state.servicos
    .filter((s) => !search || normalize(s.nome).includes(search))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  document.querySelector("#serviceList").innerHTML = filtered.length
    ? filtered.map(serviceCard).join("")
    : empty("Nenhum serviço cadastrado.");
  document.querySelectorAll("[data-edit-service]").forEach((button) => {
    button.addEventListener("click", () => openService(button.dataset.editService));
  });
}

function renderPackages() {
  const search = normalize(document.querySelector("#packageSearch")?.value || "");
  const filtered = state.pacotes
    .filter((pacote) => !search || normalize(`${pacote.nome} ${pacote.nomeCliente}`).includes(search))
    .sort((a, b) => String(b.dataCompra || "").localeCompare(String(a.dataCompra || "")));
  document.querySelector("#packageList").innerHTML = filtered.length
    ? filtered.map(packageCard).join("")
    : empty("Nenhum pacote cadastrado.");
  document.querySelectorAll("[data-edit-package]").forEach((button) => {
    button.addEventListener("click", () => openPackage(button.dataset.editPackage));
  });
}

function renderEmployees() {
  const isAdmin = checkPermission("admin");

  // Ocultar/mostrar botões de novo funcionário
  const openEmployeeModalAdmin = document.querySelector("#openEmployeeModalAdmin");
  const openEmployeeModal = document.querySelector("#openEmployeeModal");
  if (openEmployeeModalAdmin) openEmployeeModalAdmin.style.display = isAdmin ? "inline-block" : "none";
  if (openEmployeeModal) openEmployeeModal.style.display = isAdmin ? "inline-block" : "none";

  if (!isAdmin) {
    document.querySelector("#employeeList").innerHTML = empty("Acesso negado.");
    const adminEmployeeList = document.querySelector("#adminEmployeeList");
    if (adminEmployeeList) adminEmployeeList.innerHTML = empty("Acesso negado.");
    return;
  }

  const employeeList = document.querySelector("#employeeList");
  const adminEmployeeList = document.querySelector("#adminEmployeeList");
  if (employeeList) employeeList.innerHTML = "<div class='loading'>Carregando funcionários...</div>";
  if (adminEmployeeList) adminEmployeeList.innerHTML = "<div class='loading'>Carregando funcionários...</div>";

  remoteDb.collection("users").get().then((snapshot) => {
    const employees = [];
    snapshot.forEach((doc) => {
      employees.push({ id: doc.id, ...doc.data() });
    });

    const content = employees.length
      ? employees.map(employeeCard).join("")
      : empty("Nenhum funcionário cadastrado.");

    if (employeeList) employeeList.innerHTML = content;
    if (adminEmployeeList) adminEmployeeList.innerHTML = content;

    document.querySelectorAll("[data-edit-employee]").forEach((button) => {
      button.addEventListener("click", () => openEmployee(button.dataset.editEmployee));
    });

    document.querySelectorAll("[data-delete-employee]").forEach((button) => {
      button.addEventListener("click", () => deleteEmployee(button.dataset.deleteEmployee));
    });
  }).catch((error) => {
    console.error("Erro ao carregar funcionários:", error);
    if (employeeList) employeeList.innerHTML = empty("Erro ao carregar funcionários.");
    if (adminEmployeeList) adminEmployeeList.innerHTML = empty("Erro ao carregar funcionários.");
  });
}

function employeeCard(employee) {
  const permissions = employee.permissions || {};
  const permCount = Object.values(permissions).filter(Boolean).length;
  return `
    <article class="item-card employee-item">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(employee.name || "Sem nome")}</h3>
          <div class="muted">${escapeHtml(employee.email)}</div>
          <div class="muted">${permCount} permissões ativas</div>
        </div>
        <div class="item-actions">
          <button class="ghost-button" data-edit-employee="${employee.id}">Editar</button>
          <button class="danger-button" data-delete-employee="${employee.id}">Excluir</button>
        </div>
      </div>
    </article>
  `;
}

function openEmployee(employeeId = null) {
  if (!checkPermission("admin")) {
    toast("Apenas administradores podem gerenciar funcionários.");
    return;
  }

  const form = document.querySelector("#employeeForm");
  form.reset();
  document.querySelector("#employeeId").value = employeeId || "";

  if (employeeId) {
    // Load existing employee
    remoteDb.collection("users").doc(employeeId).get().then((doc) => {
      if (doc.exists) {
        const employee = doc.data();
        document.querySelector("#employeeName").value = employee.name || "";
        document.querySelector("#employeeUsername").value = employee.username || "";
        document.querySelector("#employeeEmail").value = employee.email || "";
        document.querySelector("#employeePassword").value = ""; // Don't populate password

        const permissions = employee.permissions || {};
        document.querySelector("#permViewDashboard").checked = permissions.viewDashboard || false;
        document.querySelector("#permViewAgenda").checked = permissions.viewAgenda || false;
        document.querySelector("#permCreateClient").checked = permissions.createClient || false;
        document.querySelector("#permEditClient").checked = permissions.editClient || false;
        document.querySelector("#permCreateAppointment").checked = permissions.createAppointment || false;
        document.querySelector("#permEditAppointment").checked = permissions.editAppointment || false;
        document.querySelector("#permChangeStatus").checked = permissions.changeStatus || false;
        document.querySelector("#permViewFinance").checked = permissions.viewFinance || false;
        document.querySelector("#permAdmin").checked = permissions.admin || false;
      }
    }).catch((error) => {
      console.error("Erro ao carregar funcionário:", error);
      toast("Erro ao carregar funcionário.");
    });
  }

  document.querySelector("#employeeModal").showModal();
}

function deleteEmployee(employeeId) {
  if (!checkPermission("admin")) {
    toast("Apenas administradores podem excluir funcionários.");
    return;
  }

  if (!confirm("Tem certeza que deseja excluir este funcionário? Esta ação não pode ser desfeita.")) {
    return;
  }

  remoteDb.collection("users").doc(employeeId).delete().then(() => {
    toast("Funcionário excluído com sucesso.");
    renderEmployees();
  }).catch((error) => {
    console.error("Erro ao excluir funcionário:", error);
    toast("Erro ao excluir funcionário.");
  });
}

function packageCard(pacote) {
  const peMaoRestante = packageRemaining(pacote, "peMao");
  const maoRestante = packageRemaining(pacote, "mao");
  const validade = pacote.validade ? ` · validade ${new Date(`${pacote.validade}T00:00`).toLocaleDateString("pt-BR")}` : "";
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(pacote.nome)}</h3>
          <div class="muted">${escapeHtml(pacote.nomeCliente)}${validade}</div>
        </div>
        <span class="badge ${pacote.status === "finalizado" ? "concluido" : ""}">${pacote.status}</span>
      </div>
      <div>Valor pago: <strong>${money(pacote.valorPago)}</strong></div>
      <div>Pé e mão: <strong>${peMaoRestante}</strong> de ${pacote.peMaoTotal} restante(s)</div>
      <div>Mão: <strong>${maoRestante}</strong> de ${pacote.maoTotal} restante(s)</div>
      <div class="actions">
        <button class="ghost-button" data-edit-package="${pacote.id}">Editar</button>
      </div>
    </article>
  `;
}

function serviceCard(service) {
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(service.nome)}</h3>
          <div class="muted">${service.duracaoMinutos} min · ${service.ativo ? "Ativo" : "Inativo"}</div>
        </div>
        <button class="ghost-button" data-edit-service="${service.id}">Editar</button>
      </div>
      <strong>${money(service.valorPadrao)}</strong>
    </article>
  `;
}

function renderFinance() {
  const month = document.querySelector("#financeMonth").value;
  const type = document.querySelector("#financeType").value;
  const filtered = state.financeiro
    .filter((f) => !month || inMonth(f.data, month))
    .filter((f) => type === "todos" || f.tipo === type)
    .sort((a, b) => b.data.localeCompare(a.data));
  const income = sum(state.financeiro.filter((f) => (!month || inMonth(f.data, month)) && f.tipo === "entrada"));
  const outcome = sum(state.financeiro.filter((f) => (!month || inMonth(f.data, month)) && f.tipo === "saida"));
  document.querySelector("#financeIncome").textContent = money(income);
  document.querySelector("#financeOutcome").textContent = money(outcome);
  document.querySelector("#financeProfit").textContent = money(income - outcome);
  document.querySelector("#financeList").innerHTML = filtered.length
    ? filtered.map(financeCard).join("")
    : empty("Nenhum lançamento encontrado.");
  document.querySelectorAll("[data-edit-finance]").forEach((button) => {
    button.addEventListener("click", () => openFinance(button.dataset.editFinance));
  });
}

function financeCard(entry) {
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(entry.descricao)}</h3>
          <div class="muted">${new Date(`${entry.data}T00:00`).toLocaleDateString("pt-BR")} · ${escapeHtml(entry.categoria)} · ${entry.origem}</div>
        </div>
        <span class="badge ${entry.tipo === "saida" ? "cancelado" : "concluido"}">${entry.tipo}</span>
      </div>
      <div><strong>${money(entry.valor)}</strong></div>
      <div class="actions">
        <button class="ghost-button" data-edit-finance="${entry.id}">Editar</button>
      </div>
    </article>
  `;
}

function fillSelects() {
  const clientSelect = document.querySelector("#appointmentClient");
  const packageClientSelect = document.querySelector("#packageClient");
  const serviceSelect = document.querySelector("#appointmentService");
  const serviceSelect2 = document.querySelector("#appointmentService2");
  const clientOptions = state.clientes
    .map((c) => `<option value="${c.id}">${escapeHtml(c.nome)} · ${escapeHtml(c.telefone)}</option>`)
    .join("");
  clientSelect.innerHTML = `<option value="">Selecione</option>${clientOptions}`;
  packageClientSelect.innerHTML = `<option value="">Selecione</option>${clientOptions}`;
  const serviceOptions = state.servicos
    .filter((s) => s.ativo)
    .map((s) => `<option value="${s.id}">${escapeHtml(s.nome)} · ${money(s.valorPadrao)}</option>`)
    .join("");
  serviceSelect.innerHTML = `<option value="">Selecione</option>${serviceOptions}`;
  serviceSelect2.innerHTML = `<option value="">Nenhum</option>${serviceOptions}`;
  fillAppointmentPackages();
}

function fillAppointmentPackages() {
  const packageSelect = document.querySelector("#appointmentPackage");
  const packageHelp = document.querySelector("#packageHelp");
  const usePackage = document.querySelector("#usePackage");
  const clientId = document.querySelector("#appointmentClient").value;
  if (!clientId) {
    packageSelect.innerHTML = `<option value="">Escolha uma cliente primeiro</option>`;
    packageSelect.disabled = true;
    document.querySelector("#packageCreditType").disabled = true;
    usePackage.checked = false;
    packageHelp.textContent = "Escolha uma cliente para ver os pacotes disponíveis.";
    updatePackageModeFields();
    return;
  }
  const packages = state.pacotes.filter((pacote) => pacote.clienteId === clientId && pacote.status !== "finalizado");
  if (!packages.length) {
    packageSelect.innerHTML = `<option value="">Cliente sem pacote ativo</option>`;
    packageSelect.disabled = true;
    document.querySelector("#packageCreditType").disabled = true;
    usePackage.checked = false;
    packageHelp.textContent = "Esta cliente ainda não tem pacote ativo. Cadastre em Pacotes > Novo pacote.";
    updatePackageModeFields();
    return;
  }
  packageSelect.innerHTML = `<option value="">Selecione</option>${packages
    .map(
      (pacote) =>
        `<option value="${pacote.id}">${escapeHtml(pacote.nome)} · Pé e mão ${packageRemaining(pacote, "peMao")} · Mão ${packageRemaining(pacote, "mao")}</option>`,
    )
    .join("")}`;
  packageSelect.disabled = !usePackage.checked;
  document.querySelector("#packageCreditType").disabled = !usePackage.checked;
  packageHelp.textContent = usePackage.checked
    ? "Escolha o pacote e o tipo de crédito que este atendimento vai consumir."
    : "Marque 'Usar pacote da cliente' se este atendimento deve consumir crédito.";
  updatePackageModeFields();
}

function updatePackageModeFields() {
  const usePackage = document.querySelector("#usePackage").checked;
  document.querySelectorAll(".package-field").forEach((field) => {
    field.style.display = usePackage ? "grid" : "none";
  });
  document.querySelectorAll(".service-field, .payment-field").forEach((field) => {
    field.style.display = usePackage ? "none" : "grid";
  });
  document.querySelector("#appointmentPrice").disabled = usePackage;
  document.querySelector("#discountType").disabled = usePackage;
  document.querySelector("#discountValue").disabled = usePackage;
  if (usePackage) {
    document.querySelector("#appointmentPrice").value = 0;
    document.querySelector("#discountType").value = "nenhum";
    document.querySelector("#discountValue").value = 0;
  }
  updateFinalPreview();
}

function openClient(clientId = "") {
  const client = state.clientes.find((c) => c.id === clientId);
  document.querySelector("#clientId").value = client?.id || "";
  document.querySelector("#clientName").value = client?.nome || "";
  document.querySelector("#clientPhone").value = client?.telefone || "";
  document.querySelector("#clientNotes").value = client?.observacoes || "";
  document.querySelector("#clientModal").showModal();
}

function openService(serviceId = "") {
  const service = state.servicos.find((s) => s.id === serviceId);
  document.querySelector("#serviceId").value = service?.id || "";
  document.querySelector("#serviceName").value = service?.nome || "";
  document.querySelector("#servicePrice").value = service?.valorPadrao ?? "";
  document.querySelector("#serviceDuration").value = service?.duracaoMinutos || 60;
  document.querySelector("#serviceActive").checked = service?.ativo ?? true;
  document.querySelector("#serviceModal").showModal();
}

function openPackage(packageId = "") {
  fillSelects();
  const pacote = state.pacotes.find((item) => item.id === packageId);
  document.querySelector("#packageId").value = pacote?.id || "";
  document.querySelector("#packageClient").value = pacote?.clienteId || "";
  document.querySelector("#packageName").value = pacote?.nome || "Pacote mensal";
  document.querySelector("#packageValue").value = pacote?.valorPago ?? "";
  document.querySelector("#packagePeMao").value = pacote?.peMaoTotal ?? 2;
  document.querySelector("#packageMao").value = pacote?.maoTotal ?? 2;
  document.querySelector("#packageExpires").value = pacote?.validade || "";
  document.querySelector("#packageModal").showModal();
}

function openAppointment(appointmentId = "") {
  fillSelects();
  const item = state.agendamentos.find((a) => a.id === appointmentId);
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(now.getTime() + 60 * 60 * 1000);

  document.querySelector("#appointmentId").value = item?.id || "";
  document.querySelector("#appointmentClient").value = item?.clienteId || "";
  fillAppointmentPackages();
  document.querySelector("#appointmentService").value = item?.servicoId || "";
  document.querySelector("#appointmentService2").value = item?.servicoId2 || "";
  document.querySelector("#usePackage").checked = Boolean(item?.usarPacote);
  fillAppointmentPackages();
  document.querySelector("#appointmentPackage").value = item?.pacoteId || "";
  document.querySelector("#packageCreditType").value = item?.tipoCreditoPacote || "peMao";
  document.querySelector("#appointmentStart").value = item?.dataHoraInicio || toDateTimeInput(now);
  document.querySelector("#appointmentEnd").value = item?.dataHoraFim || toDateTimeInput(end);
  document.querySelector("#appointmentPrice").value = item?.valorServico ?? "";
  document.querySelector("#discountType").value = item?.descontoTipo || "nenhum";
  document.querySelector("#discountValue").value = item?.descontoValor ?? 0;
  document.querySelector("#appointmentStatus").value = item?.status || "Agendado";
  document.querySelector("#appointmentNotes").value = item?.observacoes || "";
  document.querySelector("#deleteAppointment").style.visibility = item ? "visible" : "hidden";
  updateFinalPreview();
  document.querySelector("#appointmentModal").showModal();
}

function openFinance(financeId = "") {
  const entry = state.financeiro.find((f) => f.id === financeId);
  document.querySelector("#financeId").value = entry?.id || "";
  document.querySelector("#financeEntryType").value = entry?.tipo || "entrada";
  document.querySelector("#financeDescription").value = entry?.descricao || "";
  document.querySelector("#financeCategory").value = entry?.categoria || "";
  document.querySelector("#financeValue").value = entry?.valor ?? "";
  document.querySelector("#financeDate").value = entry?.data || toDateInput(new Date());
  document.querySelector("#deleteFinance").style.visibility = entry ? "visible" : "hidden";
  document.querySelector("#financeModal").showModal();
}

function updateAppointmentStatus(appointmentId, status) {
  const appointment = state.agendamentos.find((a) => a.id === appointmentId);
  if (!appointment) return;
  if (status === "Concluído" && appointment.usarPacote && packageAvailability(appointment.pacoteId, appointment.tipoCreditoPacote, appointment.id) <= 0) {
    renderAppointments();
    toast(`Este pacote não tem crédito disponível de ${packageCreditLabel(appointment.tipoCreditoPacote)}.`);
    return;
  }
  const candidate = { ...appointment, status };
  const conflict = getScheduleConflict(candidate);
  if (conflict) {
    showConflictDialog(conflict);
    renderAppointments();
    return;
  }
  appointment.status = status;
  const financeAction = syncAppointmentFinance(appointment);
  recomputePackageUsage();
  save();
  renderAll();
  if (financeAction === "created") toast("Entrada criada no financeiro automaticamente.");
  else if (financeAction === "updated") toast("Entrada financeira atualizada automaticamente.");
  else if (financeAction === "removed") toast("Entrada removida do financeiro automaticamente.");
  else toast("Status atualizado.");
}

function sendAppointmentWhatsapp(appointmentId) {
  const appointment = state.agendamentos.find((item) => item.id === appointmentId);
  if (!appointment) return;
  const phone = appointment.telefone.replace(/\D/g, "");
  if (!phone) {
    toast("Cliente sem telefone cadastrado.");
    return;
  }
  const whatsappPhone = phone.startsWith("55") ? phone : `55${phone}`;
  const start = parseDate(appointment.dataHoraInicio);
  const end = parseDate(appointment.dataHoraFim);
  const message = [
    `Olá, ${appointment.nomeCliente}!`,
    "",
    "Segue seu comprovante de agendamento:",
    `Nail designer: Rayssa Oliveira`,
    `Serviço: ${appointmentServiceName(appointment)}`,
    `Data: ${start.toLocaleDateString("pt-BR")}`,
    `Chegada: ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} com 15 minutos de tolerância para atraso`,
    `Saída: ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    `Valor: ${appointment.usarPacote ? "Pacote pré-pago" : money(appointment.valorFinal)}`,
    `Status: ${appointment.status}`,
    "",
    "Obrigada pela preferência!",
  ].join("\n");
  window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

function showConflictDialog(conflict) {
  const appointment = conflict.appointment;
  const start = parseDate(appointment.dataHoraInicio);
  const end = parseDate(appointment.dataHoraFim);
  lastConflictSuggestion = conflict.suggestion;
  document.querySelector("#conflictDetails").innerHTML = `
    <div class="item-card">
      <strong>Este horário já está ocupado.</strong>
      <div>Cliente: ${escapeHtml(appointment.nomeCliente)}</div>
      <div>Serviço: ${escapeHtml(appointmentServiceName(appointment))}</div>
      <div>Horário ocupado: ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
    </div>
    <div class="final-value">
      Sugestão: iniciar às <strong>${conflict.suggestion.start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
      e finalizar às <strong>${conflict.suggestion.end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>.
    </div>
  `;
  document.querySelector("#conflictModal").showModal();
}

function updateFinalPreview() {
  const value = calculateFinalValue(
    document.querySelector("#appointmentPrice").value,
    document.querySelector("#discountType").value,
    document.querySelector("#discountValue").value,
  );
  document.querySelector("#finalValuePreview").textContent = money(value);
}

function sum(items) {
  return items.reduce((total, item) => total + Number(item.valor || 0), 0);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusClass(status) {
  return normalize(status).replace("í", "i");
}

function empty(message) {
  return `<div class="empty">${message}</div>`;
}

function bindForms() {
  document.querySelector("#clientForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const clientId = document.querySelector("#clientId").value;
    const payload = {
      id: clientId || id(),
      nome: document.querySelector("#clientName").value.trim(),
      telefone: document.querySelector("#clientPhone").value.trim(),
      observacoes: document.querySelector("#clientNotes").value.trim(),
      dataCadastro: new Date().toISOString(),
    };
    if (clientId) {
      Object.assign(state.clientes.find((c) => c.id === clientId), payload);
      state.agendamentos.filter((a) => a.clienteId === clientId).forEach((a) => {
        a.nomeCliente = payload.nome;
        a.telefone = payload.telefone;
      });
      state.pacotes.filter((pacote) => pacote.clienteId === clientId).forEach((pacote) => {
        pacote.nomeCliente = payload.nome;
        syncPackageFinance(pacote);
      });
    } else {
      state.clientes.push(payload);
    }
    save();
    document.querySelector("#clientModal").close();
    renderAll();
    toast("Cliente salvo.");
  });

  document.querySelector("#serviceForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const serviceId = document.querySelector("#serviceId").value;
    const payload = {
      id: serviceId || id(),
      nome: document.querySelector("#serviceName").value.trim(),
      valorPadrao: Number(document.querySelector("#servicePrice").value),
      duracaoMinutos: Number(document.querySelector("#serviceDuration").value),
      ativo: document.querySelector("#serviceActive").checked,
      dataCadastro: new Date().toISOString(),
    };
    if (serviceId) Object.assign(state.servicos.find((s) => s.id === serviceId), payload);
    else state.servicos.push(payload);
    save();
    document.querySelector("#serviceModal").close();
    renderAll();
    toast("Serviço salvo.");
  });

  document.querySelector("#packageForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const packageId = document.querySelector("#packageId").value;
    const client = state.clientes.find((item) => item.id === document.querySelector("#packageClient").value);
    if (!client) return toast("Selecione a cliente do pacote.");
    const payload = {
      id: packageId || id(),
      clienteId: client.id,
      nomeCliente: client.nome,
      nome: document.querySelector("#packageName").value.trim(),
      valorPago: Number(document.querySelector("#packageValue").value),
      peMaoTotal: Number(document.querySelector("#packagePeMao").value || 0),
      maoTotal: Number(document.querySelector("#packageMao").value || 0),
      peMaoUsado: 0,
      maoUsado: 0,
      validade: document.querySelector("#packageExpires").value,
      dataCompra: new Date().toISOString(),
      status: "ativo",
      dataCadastro: new Date().toISOString(),
    };
    if (payload.valorPago <= 0) return toast("Informe o valor pago do pacote.");
    if (payload.peMaoTotal + payload.maoTotal <= 0) return toast("Informe ao menos um crédito no pacote.");

    const existing = state.pacotes.find((item) => item.id === packageId);
    if (existing) {
      payload.dataCompra = existing.dataCompra;
      payload.dataCadastro = existing.dataCadastro;
      Object.assign(existing, payload);
      syncPackageFinance(existing);
    } else {
      state.pacotes.push(payload);
      syncPackageFinance(payload);
    }
    recomputePackageUsage();
    save();
    document.querySelector("#packageModal").close();
    renderAll();
    toast("Pacote salvo e financeiro atualizado.");
  });

  document.querySelector("#appointmentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const appointmentId = document.querySelector("#appointmentId").value;
    const client = state.clientes.find((c) => c.id === document.querySelector("#appointmentClient").value);
    const service = state.servicos.find((s) => s.id === document.querySelector("#appointmentService").value);
    const service2 = state.servicos.find((s) => s.id === document.querySelector("#appointmentService2").value);
    const usarPacote = document.querySelector("#usePackage").checked;
    const pacoteId = document.querySelector("#appointmentPackage").value;
    const tipoCreditoPacote = document.querySelector("#packageCreditType").value;
    const price = usarPacote ? 0 : Number(document.querySelector("#appointmentPrice").value);
    const finalValue = calculateFinalValue(price, document.querySelector("#discountType").value, document.querySelector("#discountValue").value);
    const start = document.querySelector("#appointmentStart").value;
    const end = document.querySelector("#appointmentEnd").value;
    if (!client) return toast("Selecione a cliente.");
    if (!usarPacote && !service) return toast("Selecione o serviço.");
    if (!usarPacote && (!price || price <= 0)) return toast("Agendamento precisa ter valor.");
    if (parseDate(end) <= parseDate(start)) return toast("O fim precisa ser depois do início.");
    if (usarPacote && !pacoteId) return toast("Selecione o pacote da cliente.");
    if (usarPacote && document.querySelector("#appointmentStatus").value === "Concluído" && packageAvailability(pacoteId, tipoCreditoPacote, appointmentId) <= 0) {
      return toast(`Este pacote não tem crédito disponível de ${packageCreditLabel(tipoCreditoPacote)}.`);
    }

    const existing = state.agendamentos.find((a) => a.id === appointmentId);
    const payload = {
      id: appointmentId || id(),
      clienteId: client.id,
      nomeCliente: client.nome,
      telefone: client.telefone,
      servicoId: service?.id || "",
      nomeServico: service?.nome || (usarPacote ? packageCreditLabel(tipoCreditoPacote) : ""),
      servicoId2: service2?.id || "",
      nomeServico2: service2?.nome || "",
      valorServico: price,
      descontoTipo: document.querySelector("#discountType").value,
      descontoValor: Number(document.querySelector("#discountValue").value || 0),
      valorFinal: finalValue,
      dataHoraInicio: start,
      dataHoraFim: end,
      status: document.querySelector("#appointmentStatus").value,
      observacoes: document.querySelector("#appointmentNotes").value.trim(),
      usarPacote,
      pacoteId: usarPacote ? pacoteId : "",
      tipoCreditoPacote: usarPacote ? tipoCreditoPacote : "",
      financeiroGerado: existing?.financeiroGerado || false,
      dataCadastro: existing?.dataCadastro || new Date().toISOString(),
    };

    const conflict = getScheduleConflict(payload);
    if (conflict) {
      showConflictDialog(conflict);
      return;
    }
    let savedAppointment = payload;
    if (appointmentId) {
      Object.assign(existing, payload);
      savedAppointment = existing;
    } else {
      state.agendamentos.push(payload);
    }
    const financeAction = syncAppointmentFinance(savedAppointment);
    recomputePackageUsage();
    save();
    document.querySelector("#appointmentModal").close();
    renderAll();
    if (financeAction === "created") toast("Agendamento salvo e entrada financeira criada.");
    else if (financeAction === "updated") toast("Agendamento salvo e financeiro atualizado.");
    else if (financeAction === "removed") toast("Agendamento salvo e financeiro removido.");
    else toast("Agendamento salvo.");
  });

  document.querySelector("#financeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const financeId = document.querySelector("#financeId").value;
    const payload = {
      id: financeId || id(),
      tipo: document.querySelector("#financeEntryType").value,
      descricao: document.querySelector("#financeDescription").value.trim(),
      categoria: document.querySelector("#financeCategory").value.trim(),
      valor: Number(document.querySelector("#financeValue").value),
      data: document.querySelector("#financeDate").value,
      origem: "manual",
      agendamentoId: "",
      dataCadastro: new Date().toISOString(),
    };
    if (financeId) Object.assign(state.financeiro.find((f) => f.id === financeId), payload);
    else state.financeiro.push(payload);
    save();
    document.querySelector("#financeModal").close();
    renderAll();
    toast("Lançamento salvo.");
  });

  document.querySelector("#adminForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.companyName = document.querySelector("#settingCompanyName").value.trim() || DEFAULT_SETTINGS.companyName;
    state.settings.subtitle = document.querySelector("#settingSubtitle").value.trim() || DEFAULT_SETTINGS.subtitle;
    state.settings.logoText = document.querySelector("#settingLogoText").value.trim() || state.settings.companyName.slice(0, 1).toUpperCase();
    state.settings.colors.green = document.querySelector("#settingGreen").value;
    state.settings.colors.greenDark = document.querySelector("#settingGreenDark").value;
    state.settings.colors.beige = document.querySelector("#settingBeige").value;
    state.settings.colors.ink = document.querySelector("#settingInk").value;
    save();
    renderAll();
    toast("Configurações salvas.");
  });

  document.querySelector("#loginForm").addEventListener("submit", handleAuthSubmit);

  document.querySelector("#employeeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!checkPermission("admin")) {
      toast("Apenas administradores podem gerenciar funcionários.");
      return;
    }

    const employeeId = document.querySelector("#employeeId").value;
    const name = document.querySelector("#employeeName").value.trim();
    const username = document.querySelector("#employeeUsername").value.trim();
    const email = document.querySelector("#employeeEmail").value.trim();
    const password = document.querySelector("#employeePassword").value;

    const permissions = {
      viewDashboard: document.querySelector("#permViewDashboard").checked,
      viewAgenda: document.querySelector("#permViewAgenda").checked,
      createClient: document.querySelector("#permCreateClient").checked,
      editClient: document.querySelector("#permEditClient").checked,
      createAppointment: document.querySelector("#permCreateAppointment").checked,
      editAppointment: document.querySelector("#permEditAppointment").checked,
      changeStatus: document.querySelector("#permChangeStatus").checked,
      viewFinance: document.querySelector("#permViewFinance").checked,
      admin: document.querySelector("#permAdmin").checked,
    };

    try {
      if (employeeId) {
        // Update existing employee
        const userRef = remoteDb.collection("users").doc(employeeId);
        await userRef.update({
          name,
          username,
          email,
          permissions,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (password) {
          // Update password if provided
          const user = await firebase.auth().getUser(employeeId);
          await firebase.auth().updateUser(employeeId, { password });
        }
      } else {
        // Create new employee
        const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const uid = userCredential.user.uid;
        await remoteDb.collection("users").doc(uid).set({
          name,
          username,
          email,
          permissions,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      document.querySelector("#employeeForm").reset();
      document.querySelector("#employeeModal").close();
      renderEmployees();
      toast("Funcionário salvo com sucesso.");
    } catch (error) {
      console.error("Erro ao salvar funcionário:", error);
      toast("Erro ao salvar funcionário: " + error.message);
    }
  });
}

function bindButtons() {
  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-appointment]");
    if (editButton) openAppointment(editButton.dataset.editAppointment);
    const whatsappButton = event.target.closest("[data-whatsapp-appointment]");
    if (whatsappButton) sendAppointmentWhatsapp(whatsappButton.dataset.whatsappAppointment);
  });

  document.querySelector("#openClientModal").addEventListener("click", () => openClient());
  document.querySelector("#openServiceModal").addEventListener("click", () => openService());
  document.querySelector("#openAppointmentModal").addEventListener("click", () => openAppointment());
  document.querySelector("#quickAppointment").addEventListener("click", () => openAppointment());
  document.querySelector("#openEmployeeModalAdmin").addEventListener("click", () => {
    if (!checkPermission("admin")) {
      toast("Apenas administradores podem gerenciar funcionários.");
      return;
    }
    openEmployee();
  });
  document.querySelector("#openEmployeeModal").addEventListener("click", () => {
    if (!checkPermission("admin")) {
      toast("Apenas administradores podem gerenciar funcionários.");
      return;
    }
    openEmployee();
  });
  document.querySelector("#openFinanceModal").addEventListener("click", () => openFinance());
  document.querySelector("#openPackageModal").addEventListener("click", () => openPackage());
  document.querySelector("#currentMonth").addEventListener("click", renderMonthCalendar);
  document.querySelector("#mobileMoreButton").addEventListener("click", () => {
    document.querySelector("#mobileMoreMenu").classList.toggle("open");
  });
  document.querySelector("#resetSettings").addEventListener("click", () => {
    state.settings = defaultSettings();
    save();
    renderAll();
    toast("Configurações restauradas.");
  });
  document.querySelector("#settingLogoImage").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      state.settings.logoImage = reader.result;
      save();
      renderAll();
      toast("Logo atualizada.");
    });
    reader.readAsDataURL(file);
  });
  document.querySelector("#applyConflictSuggestion").addEventListener("click", () => {
    if (!lastConflictSuggestion) return;
    document.querySelector("#appointmentStart").value = toDateTimeInput(lastConflictSuggestion.start);
    document.querySelector("#appointmentEnd").value = toDateTimeInput(lastConflictSuggestion.end);
    document.querySelector("#conflictModal").close();
    toast("Sugestão aplicada ao agendamento.");
  });

  document.querySelector("#deleteAppointment").addEventListener("click", () => {
    const appointmentId = document.querySelector("#appointmentId").value;
    state.agendamentos = state.agendamentos.filter((a) => a.id !== appointmentId);
    state.financeiro = state.financeiro.filter((f) => f.agendamentoId !== appointmentId);
    recomputePackageUsage();
    save();
    document.querySelector("#appointmentModal").close();
    renderAll();
    toast("Agendamento excluído.");
  });

  document.querySelector("#deleteFinance").addEventListener("click", () => {
    const financeId = document.querySelector("#financeId").value;
    state.financeiro = state.financeiro.filter((f) => f.id !== financeId);
    save();
    document.querySelector("#financeModal").close();
    renderAll();
    toast("Lançamento excluído.");
  });

  document.querySelector("#exportBackup").addEventListener("click", exportBackup);
  document.querySelector("#importBackup").addEventListener("click", () => document.querySelector("#backupFile").click());
  document.querySelector("#backupFile").addEventListener("change", importBackup);
  document.querySelector("#installApp").addEventListener("click", installApp);
  document.querySelector("#exportPdf").addEventListener("click", exportPdf);

  updateInstallAppButton();
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}

function updateInstallAppButton() {
  const installButton = document.querySelector("#installApp");
  const installHint = document.querySelector("#installAppHint");
  if (!installButton || !installHint) return;

  if (isInStandaloneMode()) {
    installButton.style.display = "none";
    installHint.textContent = "O app já está instalado.";
    return;
  }

  installButton.style.display = "inline-flex";
  if (deferredInstallPrompt) {
    installHint.textContent = "Toque para instalar o app no seu dispositivo.";
  } else if (isIos()) {
    installHint.textContent = "No iOS, use o menu Compartilhar e escolha 'Adicionar à Tela de Início'.";
  } else {
    installHint.textContent = "Use o menu do navegador para instalar o app se não aparecer o prompt.";
  }
}

async function installApp() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    if (choiceResult.outcome === "accepted") {
      toast("Instalação iniciada.");
    } else {
      toast("Instalação cancelada.");
    }
    deferredInstallPrompt = null;
    updateInstallAppButton();
    return;
  }

  if (isIos()) {
    toast("No iOS, use Compartilhar > Adicionar à Tela de Início.");
  } else {
    toast("Use o menu do navegador para instalar o app.");
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallAppButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallAppButton();
  toast("App instalado com sucesso.");
});

function bindInputs() {
  const agendaMonth = document.querySelector("#agendaMonth");
  if (agendaMonth) {
    agendaMonth.value = toMonthInput(new Date());
  }
  const financeMonth = document.querySelector("#financeMonth");
  if (financeMonth) {
    financeMonth.value = toMonthInput(new Date());
  }

  ["agendaMonth", "agendaStatus", "agendaSearch", "clientSearch", "serviceSearch", "packageSearch", "financeMonth", "financeType", "dashboardPeriod"].forEach((idName) => {
    document.querySelector(`#${idName}`).addEventListener("input", renderAll);
  });

  ["appointmentPrice", "discountType", "discountValue"].forEach((idName) => {
    document.querySelector(`#${idName}`).addEventListener("input", updateFinalPreview);
  });

  document.querySelector("#appointmentStart").addEventListener("input", updateAppointmentEndFromService);
  document.querySelector("#appointmentClient").addEventListener("change", fillAppointmentPackages);
  document.querySelector("#usePackage").addEventListener("change", fillAppointmentPackages);
  document.querySelector("#appointmentService").addEventListener("change", updateAppointmentPriceFromServices);
  document.querySelector("#appointmentService2").addEventListener("change", updateAppointmentPriceFromServices);
  ["settingCompanyName", "settingSubtitle", "settingLogoText", "settingGreen", "settingGreenDark", "settingBeige", "settingInk"].forEach((idName) => {
    document.querySelector(`#${idName}`).addEventListener("input", () => {
      state.settings.companyName = document.querySelector("#settingCompanyName").value || DEFAULT_SETTINGS.companyName;
      state.settings.subtitle = document.querySelector("#settingSubtitle").value || DEFAULT_SETTINGS.subtitle;
      state.settings.logoText = document.querySelector("#settingLogoText").value || state.settings.companyName.slice(0, 1).toUpperCase();
      state.settings.colors.green = document.querySelector("#settingGreen").value;
      state.settings.colors.greenDark = document.querySelector("#settingGreenDark").value;
      state.settings.colors.beige = document.querySelector("#settingBeige").value;
      state.settings.colors.ink = document.querySelector("#settingInk").value;
      applySettings();
    });
  });
}

function exportCsv() {
  const rows = [
    ["tipo", "descricao", "categoria", "valor", "data", "origem"],
    ...state.financeiro.map((f) => [f.tipo, f.descricao, f.categoria, f.valor, f.data, f.origem]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`financeiro-${toDateInput(new Date())}.csv`, csv, "text/csv;charset=utf-8");
}

function exportBackup() {
  const backup = {
    app: "Rayssa Oliveira Gestão",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      clientes: state.clientes,
      settings: state.settings,
      servicos: state.servicos,
      agendamentos: state.agendamentos,
      pacotes: state.pacotes,
      financeiro: state.financeiro,
    },
  };
  download(`backup-rayssa-oliveira-${toDateInput(new Date())}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
  toast("Backup completo exportado.");
}

function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const backup = JSON.parse(reader.result);
      const data = backup.data || backup;
      const requiredCollections = ["clientes", "servicos", "agendamentos", "financeiro"];
      const isValid = requiredCollections.every((collection) => Array.isArray(data[collection]));
      if (!isValid) {
        toast("Arquivo de backup inválido.");
        return;
      }
      const confirmed = confirm("Importar este backup vai substituir os dados atuais do sistema. Deseja continuar?");
      if (!confirmed) return;

      state.clientes = data.clientes;
      state.settings = data.settings || defaultSettings();
      state.servicos = data.servicos;
      state.agendamentos = data.agendamentos;
      state.pacotes = Array.isArray(data.pacotes) ? data.pacotes : [];
      state.financeiro = data.financeiro;
      recomputePackageUsage();
      state.agendamentos.forEach((appointment) => {
        appointment.financeiroGerado = state.financeiro.some((entry) => entry.origem === "agendamento" && entry.agendamentoId === appointment.id);
      });
      save();
      renderAll();
      toast("Backup completo importado.");
    } catch (error) {
      toast("Não foi possível importar o backup.");
    }
  });
  reader.readAsText(file);
}

function exportPdf() {
  const month = document.querySelector("#financeMonth").value;
  const entries = state.financeiro.filter((f) => !month || inMonth(f.data, month));
  const income = sum(entries.filter((f) => f.tipo === "entrada"));
  const outcome = sum(entries.filter((f) => f.tipo === "saida"));
  const html = `
    <html><head><title>Relatório financeiro</title><style>
      body{font-family:Arial,sans-serif;padding:32px;color:#2b2b2b}
      h1{color:#2f4f3a} table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}
      .summary{display:flex;gap:16px;margin:18px 0}.summary div{border:1px solid #ddd;padding:12px;border-radius:8px}
    </style></head><body>
      <h1>Relatório financeiro</h1>
      <p>Período: ${month || "todos"}</p>
      <div class="summary"><div>Entradas: <strong>${money(income)}</strong></div><div>Saídas: <strong>${money(outcome)}</strong></div><div>Lucro: <strong>${money(income - outcome)}</strong></div></div>
      <table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Valor</th></tr></thead><tbody>
      ${entries.map((f) => `<tr><td>${f.data}</td><td>${f.tipo}</td><td>${escapeHtml(f.descricao)}</td><td>${escapeHtml(f.categoria)}</td><td>${money(f.valor)}</td></tr>`).join("")}
      </tbody></table>
      <script>window.print();</script>
    </body></html>
  `;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

bindNavigation();
bindModalClose();
bindForms();
bindButtons();
bindInputs();
renderAll();
initAuth(); // Changed from initRemoteSync()
initRemoteSync();
