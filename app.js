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
  telefoneContato: "",
  instagram: "",
  developerCredit: "Desenvolvido por Rafael Aguiar Ribeiro · Instagram @aguiar.3d",
  colors: {
    green: "#4f7d5a",
    greenDark: "#2f4f3a",
    beige: "#f4efe6",
    ink: "#2b2b2b",
    alert: "#8a3030",
  },
  taxas: {
    debito: 1.99,
    credito: 4.99,
  },
  openingTime: "08:00",
  closingTime: "19:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
};

function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

const hasSavedState = false; // do not rely on localStorage for state persistence
const state = loadState();

let remoteDb = null;
let remoteDocRef = null;
let remoteStorage = null;
let remoteReady = false;
let applyingRemoteState = false;
let pendingRemoteSave = null;
let remoteUnsubscribe = null;
let deferredInstallPrompt = null;
let currentUser = null;
let userPermissions = {};
let afterPaymentSaveCallback = null;
const APPOINTMENT_STATUSES = ["Pendente confirmação", "Agendado", "Confirmado", "Concluído", "Cancelado"];

// Persistência de sessão: 4 horas
const SESSION_DURATION = 4 * 60 * 60 * 1000; // 4 horas em milissegundos
const SESSION_STORAGE_KEY = "nailpro-session-timestamp";

function registerSessionLogin() {
  localStorage.setItem(SESSION_STORAGE_KEY, Date.now().toString());
}

function isSessionValid() {
  const timestamp = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!timestamp) return false;
  const loginTime = parseInt(timestamp, 10);
  const now = Date.now();
  return (now - loginTime) < SESSION_DURATION;
}

function clearSessionLogin() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

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
  // Persistência local desativada: sempre inicializa a partir do estado padrão/remote

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
    landingContent: {},
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
  // Persist only to remote Firestore (do not write to localStorage)
  if (remoteDocRef && !remoteReady) {
    queueRemoteSave(true);
  } else {
    queueRemoteSave();
  }
}

function serializableState() {
  return JSON.parse(JSON.stringify({
    settings: state.settings,
    clientes: state.clientes,
    servicos: state.servicos,
    agendamentos: state.agendamentos,
    pacotes: state.pacotes,
    financeiro: state.financeiro,
    landingContent: state.landingContent || {},
  }));
}

function replaceState(nextState) {
  state.settings = {
    ...defaultSettings(),
    ...(state.settings || {}),
    ...(nextState.settings || {}),
  };
  state.clientes = Array.isArray(nextState.clientes) ? nextState.clientes : (state.clientes || []);
  state.servicos = Array.isArray(nextState.servicos) ? nextState.servicos : (state.servicos || []);
  state.agendamentos = Array.isArray(nextState.agendamentos) ? nextState.agendamentos : (state.agendamentos || []);
  state.pacotes = Array.isArray(nextState.pacotes) ? nextState.pacotes : (state.pacotes || []);
  state.financeiro = Array.isArray(nextState.financeiro) ? nextState.financeiro : (state.financeiro || []);
  state.landingContent = nextState.landingContent !== undefined ? nextState.landingContent : (state.landingContent || {});
  migrateState();
}

function isFirebaseConfigured() {
  const config = window.FIREBASE_CONFIG;
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
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);

    if (window.location.protocol === "file:") {
      showLogin();
      setLoginError(
        "O app está sendo executado via file://. Para usar Firebase Auth, rode o app em http://localhost ou publique no Firebase Hosting."
      );
      return;
    }

    // Garantir aliases de login em background (não bloqueia autenticação)
    ensureLoginAliasesInBackground();

    // Listener de autenticação — única fonte de verdade
    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        registerSessionLogin();
        await loadUserPermissions(user.uid);
        initRemoteSync();
        showApp();
        renderAll();
      } else {
        currentUser = null;
        userPermissions = {};
        stopRemoteSync();
        showLogin();
      }
    });

  } catch (error) {
    console.error("Erro ao inicializar autenticação:", error);
    showApp();
  }
}

/**
 * Garante que os aliases de login (username → email) estejam sincronizados
 * no Firestore. Roda em background sem bloquear o carregamento.
 */
function ensureLoginAliasesInBackground() {
  setTimeout(async () => {
    try {
      if (!firebase.apps.length) return;
      if (!remoteDb) remoteDb = firebase.firestore();
      await ensureAllLoginAliases();
    } catch (e) {
      // Silencioso — não crítico para o funcionamento
      console.info("Aliases de login não sincronizados:", e.message);
    }
  }, 3000); // aguarda 3s para não competir com o carregamento inicial
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
      await saveLoginAliases("admin", adminName, adminEmail);
      await ensureAllLoginAliases();
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
        await saveLoginAliases("admin", adminName, adminEmail);
        await ensureAllLoginAliases();

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
  applySettings();
  document.querySelector("#appShell").style.display = "none";
  document.querySelector("#loginOverlay").style.display = "flex";
}

function loginAliasKey(value) {
  return normalize(value).replace(/[^a-z0-9._-]/g, "");
}

async function saveLoginAliases(username, name, email) {
  if (!remoteDb) remoteDb = firebase.firestore();
  const batch = remoteDb.batch();
  const aliases = [username, name]
    .map(loginAliasKey)
    .filter(Boolean);
  if (!aliases.length) return;
  aliases.forEach((alias) => {
    batch.set(
      remoteDb.collection("loginAliases").doc(alias),
      {
        email,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
  await batch.commit();
}

async function ensureAllLoginAliases() {
  if (!remoteDb) remoteDb = firebase.firestore();
  const snapshot = await remoteDb.collection("users").get();
  const saves = [];
  snapshot.forEach((doc) => {
    const user = doc.data();
    if (user?.email) saves.push(saveLoginAliases(user.username || "", user.name || "", user.email));
  });
  await Promise.all(saves);
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

  if (!identifier || !password) {
    setLoginError("Informe o usuário/email e a senha.");
    return;
  }

  // Desabilitar botão durante o processo
  const btn = document.querySelector("#loginSubmitButton");
  if (btn) { btn.disabled = true; btn.textContent = "Entrando..."; }

  try {
    const email = await resolveLoginEmail(identifier);
    await firebase.auth().signInWithEmailAndPassword(email, password);
    // onAuthStateChanged cuida do resto (showApp, renderAll, etc.)
    document.querySelector("#loginForm").reset();
  } catch (error) {
    let errorMessage = "Não foi possível fazer login. Verifique suas credenciais.";

    if (error.code === "auth/configuration-not-found") {
      errorMessage = "Firebase Authentication não está habilitado. Acesse o console do Firebase para habilitar.";
    } else if (error.code === "auth/user-not-found" || error.code === "auth/invalid-credential") {
      errorMessage = "Usuário não encontrado. Verifique o usuário ou email digitado.";
    } else if (error.code === "auth/wrong-password") {
      errorMessage = "Senha incorreta. Tente novamente.";
    } else if (error.code === "auth/invalid-email") {
      errorMessage = "Email inválido. Verifique o formato.";
    } else if (error.code === "auth/too-many-requests") {
      errorMessage = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    } else if (error.message) {
      errorMessage = error.message;
    }

    setLoginError(errorMessage);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Entrar"; }
  }
}

async function resolveLoginEmail(identifier) {
  if (identifier.includes("@")) {
    return identifier;
  }

  try {
    if (!remoteDb) remoteDb = firebase.firestore();
    const aliasDoc = await remoteDb.collection("loginAliases").doc(loginAliasKey(identifier)).get();
    if (aliasDoc.exists && aliasDoc.data()?.email) return aliasDoc.data().email;
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
    clearSessionLogin(); // Limpar a sessão
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
  if (remoteUnsubscribe) return;

  try {
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    if (!firebase.auth().currentUser) return;
    remoteDb = firebase.firestore();
    remoteDocRef = remoteDb.doc(window.FIREBASE_DOC_PATH || "sistemas/firebase");

    remoteUnsubscribe = remoteDocRef.onSnapshot(
      (snapshot) => {
        if (!snapshot.exists) {
          remoteReady = true;
          queueRemoteSave(true);
          return;
        }

        const data = snapshot.data() || {};
        const remoteState = data.state || data;
        applyingRemoteState = true;
        replaceState(remoteState);
        // Do not persist to localStorage; rely on remote only
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
    taxas: {
      ...DEFAULT_SETTINGS.taxas,
      ...(state.settings?.taxas || {}),
    },
  };
  state.clientes ||= [];
  state.servicos ||= [];
  state.agendamentos ||= [];
  state.financeiro ||= [];
  state.pacotes ||= [];
  state.landingContent ||= {};
  state.clientes.forEach((cliente) => {
    if (cliente.clienteAtivo === undefined) cliente.clienteAtivo = true;
  });
  state.servicos.forEach((servico) => {
    if (servico.ativo === undefined) servico.ativo = true;
  });
  const needsLegacyPeMao = state.pacotes.some((pacote) => Number(pacote.peMaoTotal || 0) > 0) || state.agendamentos.some((appointment) => appointment.tipoCreditoPacote === "peMao");
  const needsLegacyMao = state.pacotes.some((pacote) => Number(pacote.maoTotal || 0) > 0) || state.agendamentos.some((appointment) => appointment.tipoCreditoPacote === "mao");
  const legacyPeMaoServiceId = needsLegacyPeMao ? ensureServiceForLegacyPackage("Pé e mão") : "";
  const legacyMaoServiceId = needsLegacyMao ? ensureServiceForLegacyPackage("Mão") : "";
  state.agendamentos.forEach((appointment) => {
    const hasFinance = state.financeiro.some((entry) => entry.origem === "agendamento" && entry.agendamentoId === appointment.id);
    const paidByHistory = hasFinance || appointment.usarPacote;
    if (appointment.statusPagamento === undefined) appointment.statusPagamento = paidByHistory ? "pago" : "pendente";
    appointment.formaPagamento ||= "";
    appointment.taxaPercentual = Number(appointment.taxaPercentual || 0);
    appointment.valorTaxa = Number(appointment.valorTaxa || 0);
    appointment.descontoPagamentoTipo ||= "nenhum";
    appointment.descontoPagamentoValor = Number(appointment.descontoPagamentoValor || 0);
    appointment.valorDescontoPagamento = Number(appointment.valorDescontoPagamento || 0);
    appointment.valorBruto = Number(appointment.valorBruto ?? appointment.valorFinal ?? 0);
    appointment.valorLiquido = Number(appointment.valorLiquido ?? appointment.valorFinal ?? 0);
    appointment.dataPagamento ||= paidByHistory ? toDateInput(appointment.dataHoraInicio || new Date()) : "";
    appointment.observacoesPagamento ||= "";
    appointment.financeiroGerado = hasFinance;
  });
  state.pacotes.forEach((pacote) => {
    pacote.creditos = packageCreditsFromLegacy(pacote, legacyPeMaoServiceId, legacyMaoServiceId);
    pacote.status ||= "ativo";
  });
  state.agendamentos.forEach((appointment) => {
    if (appointment.usarPacote && !appointment.servicoCreditoPacoteId && appointment.tipoCreditoPacote) {
      appointment.servicoCreditoPacoteId = appointment.tipoCreditoPacote === "mao" ? legacyMaoServiceId : legacyPeMaoServiceId;
    }
  });
  recomputePackageUsage();
}

function money(value) {
  return currency.format(Number(value || 0));
}

function companyName() {
  return (state.settings?.companyName || DEFAULT_SETTINGS.companyName).trim() || DEFAULT_SETTINGS.companyName;
}

function brandSlug() {
  return normalize(companyName()).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "empresa";
}

function applySettings(skipAdminFormRefresh = false) {
  const settings = state.settings;
  document.documentElement.style.setProperty("--green", settings.colors.green);
  document.documentElement.style.setProperty("--green-dark", settings.colors.greenDark);
  document.documentElement.style.setProperty("--beige", settings.colors.beige);
  document.documentElement.style.setProperty("--ink", settings.colors.ink);
  document.documentElement.style.setProperty("--alert", settings.colors.alert || DEFAULT_SETTINGS.colors.alert);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", settings.colors.green);
  document.title = `${companyName()} Gestão`;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", companyName());
  document.querySelector("#developerCredit").textContent = settings.developerCredit;

  document.querySelectorAll(".brand").forEach((brand) => {
    const mark = brand.querySelector(".brand-mark, .brand-logo");
    if (settings.logoImage) {
      const image = document.createElement("img");
      image.className = "brand-logo";
      image.src = settings.logoImage;
      image.alt = companyName();
      mark.replaceWith(image);
    } else {
      const text = document.createElement("span");
      text.className = "brand-mark";
      text.textContent = settings.logoText || companyName().slice(0, 1).toUpperCase();
      mark.replaceWith(text);
    }
    brand.querySelector("strong").textContent = companyName();
    brand.querySelector("small").textContent = settings.subtitle;
  });
  if (document.querySelector("#loginCompanyName")) document.querySelector("#loginCompanyName").textContent = companyName();
  if (document.querySelector("#loginSubtitle")) document.querySelector("#loginSubtitle").textContent = settings.subtitle || "Acesso de Funcionários";
  if (!skipAdminFormRefresh) renderAdminSettings();
}

function renderAdminSettings() {
  const form = document.querySelector("#adminForm");
  if (!form) return;
  const settings = state.settings;
  document.querySelector("#settingCompanyName").value = settings.companyName;
  document.querySelector("#settingSubtitle").value = settings.subtitle;
  document.querySelector("#settingTelefoneContato").value = settings.telefoneContato || "";
  document.querySelector("#settingInstagram").value = settings.instagram || "";
  document.querySelector("#settingLogoText").value = settings.logoText;
  document.querySelector("#settingGreen").value = settings.colors.green;
  document.querySelector("#settingGreenDark").value = settings.colors.greenDark;
  document.querySelector("#settingBeige").value = settings.colors.beige;
  document.querySelector("#settingInk").value = settings.colors.ink;
  document.querySelector("#settingAlert").value = settings.colors.alert || DEFAULT_SETTINGS.colors.alert;
  document.querySelector("#taxaDebito").value = settings.taxas.debito;
  document.querySelector("#taxaCredito").value = settings.taxas.credito;
  document.querySelector("#settingOpeningTime").value = settings.openingTime || "08:00";
  document.querySelector("#settingClosingTime").value = settings.closingTime || "19:00";
  document.querySelector("#settingLunchStart").value = settings.lunchStart || "12:00";
  document.querySelector("#settingLunchEnd").value = settings.lunchEnd || "13:00";
  document.querySelector("#settingDeveloperCredit").value = settings.developerCredit;
  document.querySelector("#adminNamePreview").textContent = companyName();
  document.querySelector("#adminSubtitlePreview").textContent = settings.subtitle;
  const preview = document.querySelector("#adminLogoPreview");
  if (settings.logoImage) {
    preview.outerHTML = `<img class="brand-logo" id="adminLogoPreview" src="${settings.logoImage}" alt="${escapeHtml(companyName())}" />`;
  } else {
    preview.outerHTML = `<span class="brand-mark" id="adminLogoPreview">${escapeHtml(settings.logoText || companyName().slice(0, 1).toUpperCase())}</span>`;
  }
}

function stopRemoteSync() {
  if (remoteUnsubscribe) {
    remoteUnsubscribe();
    remoteUnsubscribe = null;
  }
  remoteDocRef = null;
  remoteReady = false;
}

function getFirebaseStorage() {
  if (!isFirebaseConfigured()) throw new Error("Firebase não configurado.");
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  if (!remoteStorage) remoteStorage = firebase.storage();
  return remoteStorage;
}

async function uploadLandingImageFile(file, folder = "landing") {
  if (!file) throw new Error("Arquivo de imagem inválido.");
  const storage = getFirebaseStorage();
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeFileName = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}.${extension}`;
  const path = `${folder}/${safeFileName}`;
  const ref = storage.ref(path);
  const snapshot = await ref.put(file);
  return await snapshot.ref.getDownloadURL();
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
  clearTimeout(el.hideTimer);
  el.textContent = message;
  el.classList.add("show");
  el.hideTimer = setTimeout(() => el.classList.remove("show"), 2600);
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
  renderAll();
}

function calculateFinalValue(price, type, discountValue) {
  const base = Number(price || 0);
  const discount = Number(discountValue || 0);
  if (type === "porcentagem") return Math.max(0, base - base * (discount / 100));
  if (type === "valor") return Math.max(0, base - discount);
  return base;
}

function calculatePaymentDiscount(grossValue, type, value) {
  const discount = Number(value || 0);
  if (type === "porcentagem") return Math.min(grossValue, grossValue * (discount / 100));
  if (type === "valor") return Math.min(grossValue, discount);
  return 0;
}

function calculatePaymentValues(value, method, discountType = "nenhum", discountValue = 0) {
  const grossValue = Number(value || 0);
  const taxas = state.settings.taxas || DEFAULT_SETTINGS.taxas;
  let rate = 0;
  if (method === "debito") rate = Number(taxas.debito || 0);
  if (method === "credito") rate = Number(taxas.credito || 0);
  const discountAmount = method === "dinheiro" || method === "pix" ? calculatePaymentDiscount(grossValue, discountType, discountValue) : 0;
  const taxAmount = method === "debito" || method === "credito" ? grossValue * (rate / 100) : 0;
  const netValue = Math.max(0, grossValue - discountAmount - taxAmount);
  return { rate, taxAmount, discountAmount, grossValue, netValue };
}

// ─────────────────────────────────────────────────────────────────────────
// MÓDULO DE AGENDAMENTOS — lista dinâmica de serviços (múltiplos serviços)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Retorna os serviços atualmente selecionados na lista dinâmica do modal.
 * Cada linha tem um select com o serviceId selecionado.
 */
function getSelectedServiceLines() {
  return Array.from(document.querySelectorAll(".service-line-select"))
    .map((sel) => state.servicos.find((s) => s.id === sel.value))
    .filter(Boolean);
}

/**
 * Renderiza as linhas de serviço no modal de agendamento.
 * @param {Array} serviceIds - array de IDs de serviços a pré-selecionar
 */
function renderServiceLines(serviceIds = [""]) {
  const container = document.querySelector("#servicesList");
  if (!container) return;

  const activeServices = state.servicos.filter((s) => s.ativo !== false);
  const options = activeServices
    .map((s) => `<option value="${s.id}">${escapeHtml(s.nome)} · ${money(s.valorPadrao)} · ${s.duracaoMinutos}min</option>`)
    .join("");

  // Garante pelo menos uma linha
  const ids = serviceIds.length ? serviceIds : [""];

  container.innerHTML = ids.map((sid, i) => `
    <div class="service-line" data-service-line="${i}">
      <label style="grid-column:1/-1;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
        Serviço ${i + 1}
        <button type="button" class="icon-button remove-service-line" data-line="${i}"
          style="width:36px;height:36px;font-size:1.1rem;color:var(--danger)"
          ${ids.length === 1 ? "disabled title='Pelo menos 1 serviço obrigatório'" : "title='Remover serviço'"}>✕</button>
      </label>
      <select class="service-line-select" data-line="${i}">
        <option value="">Selecione</option>
        ${options}
      </select>
    </div>
  `).join("");

  // Pré-selecionar valores
  ids.forEach((sid, i) => {
    const sel = container.querySelector(`[data-line="${i}"].service-line-select`);
    if (sel && sid) sel.value = sid;
  });

  // Bind: ao trocar serviço, recalcular valor e tempo
  container.querySelectorAll(".service-line-select").forEach((sel) => {
    sel.addEventListener("change", recalcFromServices);
  });

  // Bind: remover linha
  container.querySelectorAll(".remove-service-line").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = Array.from(document.querySelectorAll(".service-line-select")).map((s) => s.value);
      current.splice(Number(btn.dataset.line), 1);
      renderServiceLines(current.length ? current : [""]);
      recalcFromServices();
    });
  });
}

/**
 * Adiciona uma linha em branco de serviço.
 */
function addServiceLine() {
  const current = Array.from(document.querySelectorAll(".service-line-select")).map((s) => s.value);
  renderServiceLines([...current, ""]);
}

/**
 * Recalcula o valor total e atualiza o horário de fim com base
 * na soma das durações de todos os serviços selecionados.
 */
function recalcFromServices() {
  const services = getSelectedServiceLines();
  const totalValue = services.reduce((sum, s) => sum + Number(s.valorPadrao || 0), 0);
  const totalMinutes = services.reduce((sum, s) => sum + Number(s.duracaoMinutos || 0), 0);

  // Atualizar valor (só se modo normal, não pacote)
  if (!document.querySelector("#usePackage")?.checked) {
    document.querySelector("#appointmentPrice").value = totalValue || "";
  }

  // Atualizar horário de fim
  const startVal = document.querySelector("#appointmentStart").value;
  if (startVal && totalMinutes > 0) {
    const start = parseDate(startVal);
    const end = new Date(start.getTime() + totalMinutes * 60000);
    document.querySelector("#appointmentEnd").value = toDateTimeInput(end);
  }

  updateFinalPreview();
}

/**
 * Nome composto dos serviços para exibição no card de agendamento.
 */
function appointmentServiceName(appointment) {
  // Novo formato: array de serviços
  if (Array.isArray(appointment.servicos) && appointment.servicos.length) {
    return appointment.servicos.map((s) => s.nome).join(" + ");
  }
  // Compatibilidade com formato antigo (servicoId / servicoId2)
  const parts = [appointment.nomeServico, appointment.nomeServico2].filter(Boolean);
  if (parts.length) return parts.join(" + ");
  if (appointment.usarPacote) return packageCreditLabel(appointment.servicoCreditoPacoteId || appointment.tipoCreditoPacote);
  return "Serviço não informado";
}

// ─────────────────────────────────────────────────────────────────────────
// MÓDULO PACOTES × AGENDAMENTOS — créditos múltiplos no mesmo atendimento
// ─────────────────────────────────────────────────────────────────────────

/**
 * Renderiza as linhas de crédito do pacote a consumir no agendamento.
 * Permite selecionar múltiplos créditos do mesmo pacote.
 */
function renderPackageCreditLines(pacoteId, existingCredits = []) {
  const container = document.querySelector("#packageCreditsContainer");
  const summary = document.querySelector("#packageCreditSummary");
  if (!container) return;

  const pacote = state.pacotes.find((p) => p.id === pacoteId);
  if (!pacote) { container.innerHTML = ""; if (summary) summary.style.display = "none"; return; }

  const appointmentId = document.querySelector("#appointmentId").value;

  const creditOptions = (pacote.creditos || []).map((credit) => {
    const disponivel = packageAvailability(pacoteId, credit.servicoId, appointmentId);
    return `<option value="${credit.servicoId}" ${disponivel <= 0 ? "disabled" : ""}>
      ${escapeHtml(credit.nomeServico || packageCreditLabel(credit.servicoId))} (${disponivel} disponível)
    </option>`;
  }).join("");

  // Uma linha por crédito a consumir; começa com 1 linha pré-selecionada
  const lines = existingCredits.length ? existingCredits : [{ servicoId: "", qty: 1 }];

  container.innerHTML = `
    <div style="display:grid;gap:8px">
      <div class="package-services-title">Créditos a consumir neste atendimento</div>
      ${lines.map((line, i) => `
        <div class="package-credit-line" style="display:grid;grid-template-columns:1fr 80px auto;gap:8px;align-items:end">
          <label>Serviço do pacote
            <select class="pkg-credit-select" data-credit-line="${i}">
              <option value="">Selecione</option>${creditOptions}
            </select>
          </label>
          <label>Qtd.
            <input type="number" class="pkg-credit-qty" data-credit-line="${i}"
              value="${line.qty || 1}" min="1" step="1" style="text-align:center" />
          </label>
          <button type="button" class="icon-button remove-credit-line" data-credit-line="${i}"
            style="width:36px;height:36px;color:var(--danger);margin-top:20px"
            ${lines.length === 1 ? "disabled" : ""}>✕</button>
        </div>
      `).join("")}
      <button type="button" class="ghost-button" id="addCreditLine" style="width:auto">+ Adicionar crédito</button>
    </div>
  `;

  // Pré-selecionar créditos existentes
  lines.forEach((line, i) => {
    const sel = container.querySelector(`[data-credit-line="${i}"].pkg-credit-select`);
    if (sel && line.servicoId) sel.value = line.servicoId;
  });

  // Bind: atualizar resumo ao mudar seleção
  container.querySelectorAll(".pkg-credit-select, .pkg-credit-qty").forEach((el) => {
    el.addEventListener("change", updatePackageCreditSummary);
  });

  // Bind: remover linha de crédito
  container.querySelectorAll(".remove-credit-line").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = readPackageCreditLines();
      current.splice(Number(btn.dataset.creditLine), 1);
      renderPackageCreditLines(pacoteId, current.length ? current : [{ servicoId: "", qty: 1 }]);
      updatePackageCreditSummary();
    });
  });

  // Bind: adicionar linha
  container.querySelector("#addCreditLine")?.addEventListener("click", () => {
    const current = readPackageCreditLines();
    renderPackageCreditLines(pacoteId, [...current, { servicoId: "", qty: 1 }]);
    updatePackageCreditSummary();
  });

  updatePackageCreditSummary();
}

/**
 * Lê as linhas de crédito do pacote preenchidas no modal.
 */
function readPackageCreditLines() {
  const lines = [];
  document.querySelectorAll(".pkg-credit-select").forEach((sel, i) => {
    const qty = Number(document.querySelectorAll(".pkg-credit-qty")[i]?.value || 1);
    lines.push({ servicoId: sel.value, qty });
  });
  return lines;
}

/**
 * Atualiza o resumo de créditos (antes/depois) no modal.
 */
function updatePackageCreditSummary() {
  const summary = document.querySelector("#packageCreditSummary");
  if (!summary) return;
  const pacoteId = document.querySelector("#appointmentPackage").value;
  const pacote = state.pacotes.find((p) => p.id === pacoteId);
  if (!pacote) { summary.style.display = "none"; return; }

  const lines = readPackageCreditLines().filter((l) => l.servicoId);
  if (!lines.length) { summary.style.display = "none"; return; }

  const appointmentId = document.querySelector("#appointmentId").value;

  const rows = lines.map((line) => {
    const credit = pacote.creditos?.find((c) => c.servicoId === line.servicoId);
    if (!credit) return "";
    const disponivel = packageAvailability(pacoteId, line.servicoId, appointmentId);
    const aposUso = disponivel - line.qty;
    return `<div style="display:flex;justify-content:space-between;font-size:0.88rem">
      <span>${escapeHtml(credit.nomeServico || packageCreditLabel(credit.servicoId))}</span>
      <span>Disponível: <strong>${disponivel}</strong> → Após: <strong class="${aposUso < 0 ? "text-danger" : ""}">${aposUso}</strong></span>
    </div>`;
  }).filter(Boolean).join("");

  summary.style.display = rows ? "block" : "none";
  summary.innerHTML = `<strong>Resumo de créditos</strong>${rows}`;
}

function ensureServiceForLegacyPackage(name) {
  let service = state.servicos.find((item) => normalize(item.nome) === normalize(name));
  if (!service) {
    service = {
      id: id(),
      nome: name,
      valorPadrao: 0,
      duracaoMinutos: 60,
      ativo: true,
      dataCadastro: new Date().toISOString(),
    };
    state.servicos.push(service);
  }
  return service.id;
}

function packageCreditsFromLegacy(pacote, peMaoServiceId, maoServiceId) {
  const current = Array.isArray(pacote.creditos) ? pacote.creditos : [];
  const credits = current
    .map((credit) => ({
      servicoId: credit.servicoId || credit.id || "",
      nomeServico: credit.nomeServico || serviceNameById(credit.servicoId || credit.id) || "",
      quantidade: Number(credit.quantidade ?? credit.total ?? 0),
      usado: Number(credit.usado || 0),
    }))
    .filter((credit) => credit.servicoId && credit.quantidade > 0);

  if (!credits.length) {
    const legacyCredits = [
      { servicoId: peMaoServiceId, total: Number(pacote.peMaoTotal || 0), used: Number(pacote.peMaoUsado || 0) },
      { servicoId: maoServiceId, total: Number(pacote.maoTotal || 0), used: Number(pacote.maoUsado || 0) },
    ];
    legacyCredits.forEach((credit) => {
      if (credit.total > 0 && credit.servicoId) {
        credits.push({
          servicoId: credit.servicoId,
          nomeServico: serviceNameById(credit.servicoId),
          quantidade: credit.total,
          usado: credit.used,
        });
      }
    });
  }
  return credits;
}

function serviceNameById(serviceId) {
  return state.servicos.find((service) => service.id === serviceId)?.nome || "";
}

function packageCreditLabel(serviceId) {
  if (serviceId === "mao") return "Mão";
  if (serviceId === "peMao") return "Pé e mão";
  return serviceNameById(serviceId) || "Serviço do pacote";
}

function packageRemaining(pacote, serviceId) {
  const credit = pacote?.creditos?.find((item) => item.servicoId === serviceId);
  if (!credit) return 0;
  return Number(credit.quantidade || 0) - Number(credit.usado || 0);
}

function packageCreditsSummary(pacote) {
  return (pacote.creditos || [])
    .map((credit) => `${escapeHtml(credit.nomeServico || packageCreditLabel(credit.servicoId))}: ${packageRemaining(pacote, credit.servicoId)} de ${credit.quantidade}`)
    .join(" · ");
}

function recomputePackageUsage() {
  if (!state.pacotes) return;

  // Zerar contagem de uso
  state.pacotes.forEach((pacote) => {
    (pacote.creditos || []).forEach((credit) => {
      credit.usado = 0;
      credit.nomeServico = credit.nomeServico || serviceNameById(credit.servicoId);
    });
  });

  // Recontabilizar a partir dos agendamentos concluídos
  state.agendamentos
    .filter((a) => a.status === "Concluído" && a.usarPacote && a.pacoteId)
    .forEach((a) => {
      const pacote = state.pacotes.find((p) => p.id === a.pacoteId);
      if (!pacote) return;

      // Novo formato: múltiplos créditos por agendamento
      if (Array.isArray(a.creditosConsumidos) && a.creditosConsumidos.length) {
        a.creditosConsumidos.forEach(({ servicoId, qty }) => {
          const credit = pacote.creditos?.find((c) => c.servicoId === servicoId);
          if (credit) credit.usado += Number(qty || 1);
        });
      } else {
        // Compatibilidade com formato antigo (1 crédito por agendamento)
        const serviceId = a.servicoCreditoPacoteId || a.tipoCreditoPacote;
        const credit = pacote.creditos?.find((c) => c.servicoId === serviceId);
        if (credit) credit.usado += 1;
      }
    });

  // Atualizar status dos pacotes
  state.pacotes.forEach((pacote) => {
    if (pacote.status === "excluido" || pacote.status === "cancelado") return;
    const allZero = (pacote.creditos || []).length > 0 &&
      pacote.creditos.every((c) => packageRemaining(pacote, c.servicoId) <= 0);
    pacote.status = allZero ? "finalizado" : "ativo";
  });
}

function packageAvailability(pacoteId, serviceId, appointmentId = "") {
  const pacote = state.pacotes.find((item) => item.id === pacoteId);
  if (!pacote) return 0;
  const usedByOthers = state.agendamentos.filter(
    (appointment) =>
      appointment.id !== appointmentId &&
      appointment.status === "Concluído" &&
      appointment.usarPacote &&
      appointment.pacoteId === pacoteId &&
      (appointment.servicoCreditoPacoteId || appointment.tipoCreditoPacote) === serviceId,
  ).length;
  const credit = pacote.creditos?.find((item) => item.servicoId === serviceId);
  const total = Number(credit?.quantidade || 0);
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

function deletePackage(packageId, closeModal = false) {
  const pacote = state.pacotes.find((item) => item.id === packageId);
  if (!pacote) return;
  const linkedAppointments = state.agendamentos.filter((appointment) => appointment.pacoteId === packageId);
  const linkedFinance = state.financeiro.filter((f) => f.pacoteId === packageId);
  if (linkedAppointments.length > 0 || linkedFinance.length > 0) {
    const msg = [
      "Não é possível excluir este pacote pois ele possui:",
      linkedAppointments.length > 0 ? `• ${linkedAppointments.length} agendamento(s) vinculado(s)` : "",
      linkedFinance.length > 0 ? `• ${linkedFinance.length} lançamento(s) financeiro(s)` : "",
      "",
      "Use o botão 'Cancelar pacote' para encerrar sem perder o histórico.",
    ].filter(Boolean).join("\n");
    alert(msg);
    return;
  }
  if (!confirm(`Excluir o pacote "${pacote.nome}"? Esta ação não pode ser desfeita.`)) return;
  state.pacotes = state.pacotes.filter((item) => item.id !== packageId);
  recomputePackageUsage();
  save();
  if (closeModal) document.querySelector("#packageModal").close();
  renderAll();
  toast("Pacote excluído.");
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

  if (appointment.statusPagamento !== "pago" || appointment.usarPacote) {
    state.financeiro = state.financeiro.filter((entry) => !(entry.origem === "agendamento" && entry.agendamentoId === appointment.id));
    appointment.financeiroGerado = false;
    return existingFinance ? "removed" : "none";
  }

  const payload = {
    tipo: "entrada",
    descricao: `Atendimento - ${appointmentServiceName(appointment)} - ${appointment.nomeCliente}`,
    categoria: "Serviço",
    valor: Number(appointment.valorLiquido ?? appointment.valorFinal ?? 0),
    data: appointment.dataPagamento || toDateInput(appointment.dataHoraInicio),
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

function resetAppointmentPayment(appointment) {
  appointment.statusPagamento = appointment.usarPacote ? "pago" : "pendente";
  appointment.formaPagamento = "";
  appointment.taxaPercentual = 0;
  appointment.valorTaxa = 0;
  appointment.descontoPagamentoTipo = "nenhum";
  appointment.descontoPagamentoValor = 0;
  appointment.valorDescontoPagamento = 0;
  appointment.valorBruto = Number(appointment.valorFinal || 0);
  appointment.valorLiquido = appointment.usarPacote ? 0 : Number(appointment.valorFinal || 0);
  appointment.dataPagamento = appointment.usarPacote ? toDateInput(appointment.dataHoraInicio || new Date()) : "";
  appointment.financeiroGerado = false;
}

function deleteAppointmentById(appointmentId) {
  state.agendamentos = state.agendamentos.filter((appointment) => appointment.id !== appointmentId);
  state.financeiro = state.financeiro.filter((entry) => entry.agendamentoId !== appointmentId);
}

function syncAppointmentFromFinance(entry) {
  if (entry.origem !== "agendamento" || !entry.agendamentoId) return;
  const appointment = state.agendamentos.find((item) => item.id === entry.agendamentoId);
  if (!appointment) return;
  if (entry.tipo !== "entrada") {
    resetAppointmentPayment(appointment);
    return;
  }
  appointment.statusPagamento = "pago";
  appointment.valorLiquido = Number(entry.valor || 0);
  appointment.valorBruto = Number(appointment.valorFinal || appointment.valorBruto || entry.valor || 0);
  appointment.valorTaxa = Math.max(0, Number(appointment.valorBruto || 0) - Number(entry.valor || 0));
  appointment.dataPagamento = entry.data || toDateInput(new Date());
  appointment.financeiroGerado = true;
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
  updatePaymentAlert();
  updateNavigationVisibility();
  fillSelects();
  // Atualizar editor de landing se a página admin estiver visível
  if (document.querySelector("#adminPage")?.classList.contains("active")) {
    if (typeof renderLandingEditor === "function") renderLandingEditor();
  }
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

let currentCalendarMonth = new Date();

function renderMonthCalendar() {
  const now = currentCalendarMonth;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const gridEnd = new Date(lastDay);
  gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
  const today = toDateInput(new Date());
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const totalDays = Math.round((gridEnd - gridStart) / 86400000) + 1;
  const days = Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  
  const monthHeader = `${months[now.getMonth()]} ${now.getFullYear()}`;
  const daysHtml = days.map((date) => {
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
  }).join("");
  
  const prevBtn = `<button class="calendar-nav-btn" onclick="previousCalendarMonth()">← Anterior</button>`;
  const nextBtn = `<button class="calendar-nav-btn" onclick="nextCalendarMonth()">Próximo →</button>`;
  
  document.querySelector("#monthCalendar").innerHTML = `
    <div class="calendar-header">
      ${prevBtn}
      <h3 class="month-header">${monthHeader}</h3>
      ${nextBtn}
    </div>
    <div class="month-grid">
      ${daysHtml}
    </div>
  `;
}

function previousCalendarMonth() {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1);
  renderMonthCalendar();
}

function nextCalendarMonth() {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1);
  renderMonthCalendar();
}

function monthEvent(appointment) {
  const start = parseDate(appointment.dataHoraInicio);
  const end = parseDate(appointment.dataHoraFim);
  const icon = getStatusIcon(appointment);
  return `
    <button class="month-event" data-edit-appointment="${appointment.id}">
      <strong>${icon} ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
      <span>${escapeHtml(appointment.nomeCliente)}</span>
      <small>${escapeHtml(appointmentServiceName(appointment))}</small>
    </button>
  `;
}

function renderRevenueChart() {
  const periodValue = document.querySelector("#dashboardPeriod").value || "currentMonth";
  const now = new Date();
  const dates = [];

  if (periodValue === "currentMonth") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < now.getDate(); i++) {
      const d = new Date(monthStart);
      d.setDate(monthStart.getDate() + i);
      dates.push(d);
    }
  } else {
    const days = Number(periodValue);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      dates.push(d);
    }
  }

  const data = dates.map((date) => {
    const key = toDateInput(date);
    return {
      key,
      label: key.slice(8),
      income: sum(state.financeiro.filter((f) => f.tipo === "entrada" && f.data === key)),
      expense: sum(state.financeiro.filter((f) => f.tipo === "saida" && f.data === key)),
    };
  });

  const CHART_H = 200; // altura útil das barras em px
  const max = Math.max(...data.map((d) => Math.max(d.income, d.expense)), 1);

  const bars = data.map((d) => {
    const incomeH = d.income > 0 ? Math.max(4, Math.round((d.income / max) * CHART_H)) : 0;
    const expenseH = d.expense > 0 ? Math.max(4, Math.round((d.expense / max) * CHART_H)) : 0;
    return `<div class="bar-group">
      <div class="bar income" style="height:${incomeH}px" title="${d.key} — Entrada: ${money(d.income)}"></div>
      <div class="bar expense" style="height:${expenseH}px" title="${d.key} — Saída: ${money(d.expense)}"></div>
      <small>${d.label}</small>
    </div>`;
  }).join("");

  document.querySelector("#revenueChart").innerHTML = `
    <div class="chart-legend">
      <span class="chart-legend-item income">Entradas</span>
      <span class="chart-legend-item expense">Saídas</span>
    </div>
    <div class="chart-bars">${bars}</div>
  `;
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
  const statusIcon = getStatusIcon(item);
  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title"><span class="status-light" title="${escapeHtml(paymentStatusLabel(item))}">${statusIcon}</span> ${escapeHtml(item.nomeCliente)}</h3>
          <div class="muted">${start.toLocaleDateString("pt-BR")} · ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
        </div>
        <span class="badge ${statusClass(item.status)}">${item.status}</span>
      </div>
      <div>${escapeHtml(appointmentServiceName(item))} · <strong>${item.usarPacote ? "Pacote pré-pago" : money(item.valorFinal)}</strong></div>
      <div class="muted">${escapeHtml(paymentStatusLabel(item))}${item.statusPagamento === "pago" && !item.usarPacote ? ` · líquido ${money(item.valorLiquido)}` : ""}</div>
      ${item.usarPacote ? `<div class="badge">Pacote: ${escapeHtml(packageCreditLabel(item.servicoCreditoPacoteId || item.tipoCreditoPacote))}</div>` : ""}
      <div class="muted">${escapeHtml(item.telefone || "")}</div>
      <div class="actions">
        <button class="ghost-button" data-edit-appointment="${item.id}">Editar</button>
        <button class="ghost-button" data-payment-appointment="${item.id}">Pagamento</button>
        <button class="ghost-button" data-whatsapp-appointment="${item.id}">WhatsApp</button>
        <select data-status-appointment="${item.id}" aria-label="Alterar status">
          ${APPOINTMENT_STATUSES.map((status) => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </div>
    </article>
  `;
}

function renderClients() {
  const search = normalize(document.querySelector("#clientSearch").value);
  const filtered = state.clientes
    .filter((c) => c.clienteAtivo !== false)
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
    .filter((s) => s.ativo !== false)
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
    .filter((pacote) => pacote.status !== "excluido")
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

// ─────────────────────────────────────────────────────────────
// MÓDULO DE PACOTES — funções de renderização e gerenciamento
// ─────────────────────────────────────────────────────────────

/**
 * Retorna o histórico de uso de um pacote: agendamentos concluídos
 * que consumiram créditos deste pacote.
 */
function getPackageHistory(pacoteId) {
  return state.agendamentos
    .filter((a) => a.usarPacote && a.pacoteId === pacoteId && a.status === "Concluído")
    .sort((a, b) => b.dataHoraInicio.localeCompare(a.dataHoraInicio));
}

/**
 * Renderiza o card de cada pacote na lista, exibindo créditos detalhados,
 * datas, status e histórico resumido.
 */
function packageCard(pacote) {
  const validade = pacote.validade
    ? new Date(`${pacote.validade}T00:00`).toLocaleDateString("pt-BR")
    : "Sem validade";
  const dataCompra = pacote.dataCompra
    ? new Date(pacote.dataCompra).toLocaleDateString("pt-BR")
    : "—";

  // Monta linhas de crédito: total / usado / restante
  const credits = (pacote.creditos || []).map((credit) => {
    const restante = packageRemaining(pacote, credit.servicoId);
    const usado = Number(credit.usado || 0);
    return `<div class="package-credit-row">
      <span>${escapeHtml(credit.nomeServico || packageCreditLabel(credit.servicoId))}</span>
      <span class="package-credit-nums">
        Total: <strong>${credit.quantidade}</strong> ·
        Usado: <strong>${usado}</strong> ·
        Restante: <strong class="${restante === 0 ? "text-danger" : ""}">${restante}</strong>
      </span>
    </div>`;
  }).join("");

  // Badge de status com cor
  const statusClass = pacote.status === "ativo" ? "concluido"
    : pacote.status === "finalizado" ? "pendente-confirmacao"
    : "cancelado"; // cancelado

  return `
    <article class="item-card">
      <div class="item-row">
        <div>
          <h3 class="item-title">${escapeHtml(pacote.nome)}</h3>
          <div class="muted">${escapeHtml(pacote.nomeCliente)}</div>
        </div>
        <span class="badge ${statusClass}">${pacote.status}</span>
      </div>
      <div class="muted" style="font-size:0.85rem">
        Criado em: ${dataCompra} · Validade: ${validade}
      </div>
      <div>Valor pago: <strong>${money(pacote.valorPago)}</strong></div>
      <div class="package-credits-list">
        ${credits || `<div class="muted">Nenhum crédito configurado.</div>`}
      </div>
      <div class="actions">
        <button class="ghost-button" data-edit-package="${pacote.id}">Editar / Histórico</button>
        ${pacote.status === "ativo" ? `<button class="ghost-button" data-cancel-package="${pacote.id}">Cancelar</button>` : ""}
        <button class="danger-button" data-delete-package="${pacote.id}">Excluir</button>
      </div>
    </article>
  `;
}

/**
 * Renderiza a lista de pacotes aplicando filtros de busca e status.
 */
function renderPackages() {
  const search = normalize(document.querySelector("#packageSearch")?.value || "");
  const statusFilter = document.querySelector("#packageStatusFilter")?.value || "ativos";

  const filtered = state.pacotes
    .filter((pacote) => {
      // Filtro de status
      if (statusFilter === "ativos") return pacote.status === "ativo";
      if (statusFilter === "todos") return pacote.status !== "excluido";
      return pacote.status === statusFilter;
    })
    .filter((pacote) => !search || normalize(`${pacote.nome} ${pacote.nomeCliente}`).includes(search))
    .sort((a, b) => String(b.dataCompra || "").localeCompare(String(a.dataCompra || "")));

  document.querySelector("#packageList").innerHTML = filtered.length
    ? filtered.map(packageCard).join("")
    : empty("Nenhum pacote encontrado para o filtro selecionado.");

  // Bind botões de editar
  document.querySelectorAll("[data-edit-package]").forEach((btn) => {
    btn.addEventListener("click", () => openPackage(btn.dataset.editPackage));
  });

  // Bind botões de cancelar pacote
  document.querySelectorAll("[data-cancel-package]").forEach((btn) => {
    btn.addEventListener("click", () => cancelPackage(btn.dataset.cancelPackage));
  });
}

/**
 * Cancela manualmente um pacote (muda status para "cancelado").
 * Não exclui nem remove dados históricos.
 */
function cancelPackage(packageId) {
  const pacote = state.pacotes.find((p) => p.id === packageId);
  if (!pacote) return;
  if (!confirm(`Deseja cancelar o pacote "${pacote.nome}" de ${pacote.nomeCliente}? O histórico será mantido.`)) return;
  pacote.status = "cancelado";
  save();
  renderAll();
  toast("Pacote cancelado. O histórico foi preservado.");
}

/**
 * Exclui pacote apenas se não houver movimentações ou agendamentos vinculados.
 * Caso contrário, bloqueia e orienta o usuário a cancelar.
 */
function deletePackage(packageId, closeModal = false) {
  const pacote = state.pacotes.find((item) => item.id === packageId);
  if (!pacote) return;

  // Verificar agendamentos vinculados
  const linkedAppointments = state.agendamentos.filter((a) => a.pacoteId === packageId);
  // Verificar movimentação financeira
  const linkedFinance = state.financeiro.filter((f) => f.pacoteId === packageId);

  if (linkedAppointments.length > 0 || linkedFinance.length > 0) {
    // Bloquear exclusão e explicar
    const msg = [
      "Não é possível excluir este pacote pois ele possui:",
      linkedAppointments.length > 0 ? `• ${linkedAppointments.length} agendamento(s) vinculado(s)` : "",
      linkedFinance.length > 0 ? `• ${linkedFinance.length} lançamento(s) financeiro(s) vinculado(s)` : "",
      "",
      "Para encerrar este pacote, use o botão 'Cancelar pacote' em vez de excluir.",
    ].filter(Boolean).join("\n");
    alert(msg);
    return;
  }

  if (!confirm(`Excluir o pacote "${pacote.nome}"? Esta ação não pode ser desfeita.`)) return;

  // Exclusão segura — sem movimentações
  state.pacotes = state.pacotes.filter((item) => item.id !== packageId);
  recomputePackageUsage();
  save();
  if (closeModal) document.querySelector("#packageModal").close();
  renderAll();
  toast("Pacote excluído.");
}

/**
 * Renderiza o histórico de uso do pacote dentro do modal.
 */
function renderPackageHistory(packageId) {
  const history = getPackageHistory(packageId);
  const section = document.querySelector("#packageHistorySection");
  const list = document.querySelector("#packageHistoryList");
  if (!section || !list) return;

  if (!history.length) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  list.innerHTML = history.map((a) => {
    const date = new Date(a.dataHoraInicio).toLocaleDateString("pt-BR");
    const time = new Date(a.dataHoraInicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const servicoNome = a.servicos
      ? a.servicos.map((s) => s.nome).join(", ")
      : (a.nomeServico || "—");
    const creditosConsumidos = a.creditosConsumidos || 1;
    return `<div class="package-history-item">
      <span class="muted">${date} ${time}</span>
      <span>${escapeHtml(a.nomeCliente)} — ${escapeHtml(servicoNome)}</span>
      <span class="muted">${creditosConsumidos} crédito(s) consumido(s)</span>
    </div>`;
  }).join("");
}

function renderPackageServiceFields(pacote = null) {
  const container = document.querySelector("#packageServices");
  if (!container) return;
  const credits = pacote?.creditos || [];
  const activeServices = state.servicos.filter((service) => service.ativo !== false);
  container.innerHTML = `
    <div class="package-services-title">Créditos por serviço</div>
    ${activeServices
      .map((service) => {
        const credit = credits.find((item) => item.servicoId === service.id);
        const checked = Boolean(credit);
        const quantity = credit?.quantidade ?? "";
        return `<label class="package-service-row">
          <span class="checkbox"><input type="checkbox" data-package-service="${service.id}" ${checked ? "checked" : ""} /> ${escapeHtml(service.nome)}</span>
          <input type="number" min="0" step="1" value="${quantity}" data-package-service-qty="${service.id}" placeholder="Qtd." ${checked ? "" : "disabled"} />
        </label>`;
      })
      .join("")}
    ${activeServices.length ? "" : `<div class="form-help">Cadastre serviços ativos antes de criar pacotes.</div>`}
  `;
  container.querySelectorAll("[data-package-service]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const qty = container.querySelector(`[data-package-service-qty="${checkbox.dataset.packageService}"]`);
      qty.disabled = !checkbox.checked;
      if (checkbox.checked && !qty.value) qty.value = 1;
      if (!checkbox.checked) qty.value = "";
    });
  });
}

function readPackageCredits() {
  return Array.from(document.querySelectorAll("[data-package-service]"))
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => {
      const service = state.servicos.find((item) => item.id === checkbox.dataset.packageService);
      const quantity = Number(document.querySelector(`[data-package-service-qty="${checkbox.dataset.packageService}"]`)?.value || 0);
      return {
        servicoId: service?.id || "",
        nomeServico: service?.nome || "",
        quantidade: quantity,
        usado: 0,
      };
    })
    .filter((credit) => credit.servicoId && credit.quantidade > 0);
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
  const clientOptions = state.clientes
    .filter((c) => c.clienteAtivo !== false)
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((c) => `<option value="${c.id}">${escapeHtml(c.nome)} · ${escapeHtml(c.telefone)}</option>`)
    .join("");
  clientSelect.innerHTML = `<option value="">Selecione</option>${clientOptions}`;
  packageClientSelect.innerHTML = `<option value="">Selecione</option>${clientOptions}`;
  // Manter selects de serviço legados compatíveis (usados em outros lugares)
  fillAppointmentPackages();
}

function fillAppointmentPackages(preserveChecked = false) {
  const packageSelect = document.querySelector("#appointmentPackage");
  const packageHelp = document.querySelector("#packageHelp");
  const usePackage = document.querySelector("#usePackage");
  const clientId = document.querySelector("#appointmentClient").value;

  if (!clientId) {
    packageSelect.innerHTML = `<option value="">Escolha uma cliente primeiro</option>`;
    packageSelect.disabled = true;
    if (!preserveChecked) usePackage.checked = false;
    if (packageHelp) packageHelp.textContent = "Escolha uma cliente para ver os pacotes disponíveis.";
    if (!preserveChecked) updatePackageModeFields();
    return;
  }

  const packages = state.pacotes.filter((p) => p.clienteId === clientId && p.status === "ativo");
  if (!packages.length) {
    packageSelect.innerHTML = `<option value="">Cliente sem pacote ativo</option>`;
    packageSelect.disabled = true;
    if (!preserveChecked) usePackage.checked = false;
    if (packageHelp) packageHelp.textContent = "Esta cliente não tem pacote ativo. Cadastre em Pacotes > Novo pacote.";
    if (!preserveChecked) updatePackageModeFields();
    return;
  }

  packageSelect.innerHTML = `<option value="">Selecione</option>` +
    packages.map((p) => `<option value="${p.id}">${escapeHtml(p.nome)} · ${packageCreditsSummary(p) || "sem créditos"}</option>`).join("");
  packageSelect.disabled = !usePackage.checked;

  if (packageHelp) packageHelp.textContent = usePackage.checked
    ? "Selecione o pacote e os créditos a consumir neste atendimento."
    : "Marque 'Usar créditos do pacote' para usar crédito pré-pago.";

  updatePackageModeFields();
}

/**
 * Atualiza a visibilidade dos campos do modal de agendamento
 * conforme o modo (pacote ou serviço normal).
 * @param {boolean} skipCreditRender - se true, não re-renderiza créditos do pacote
 *   (usado por openAppointment que já restaurou os créditos no passo anterior)
 */
function updatePackageModeFields(skipCreditRender = false) {
  const usePackage = document.querySelector("#usePackage")?.checked;

  // Mostrar/ocultar campos de pacote vs serviço normal
  document.querySelectorAll(".package-field").forEach((f) => { f.style.display = usePackage ? "" : "none"; });
  document.querySelectorAll(".service-field").forEach((f) => { f.style.display = usePackage ? "none" : ""; });
  document.querySelectorAll(".payment-field, .payment-discount-fields").forEach((f) => {
    f.style.display = usePackage ? "none" : "";
  });

  const packageSelect = document.querySelector("#appointmentPackage");
  if (packageSelect) packageSelect.disabled = !usePackage;

  if (usePackage) {
    // Ao ativar pacote: zerar valor e desabilitar campos de pagamento
    const price = document.querySelector("#appointmentPrice");
    if (price) price.value = 0;
    const payMethod = document.querySelector("#appointmentPaymentMethod");
    if (payMethod) payMethod.value = "";
    const payStatus = document.querySelector("#appointmentPaymentStatus");
    if (payStatus) payStatus.value = "pago";

    // Renderizar créditos apenas se não foi feito antes (ex: openAppointment já fez)
    if (!skipCreditRender) {
      const pacoteId = packageSelect?.value;
      if (pacoteId) renderPackageCreditLines(pacoteId);
      else {
        const c = document.querySelector("#packageCreditsContainer");
        if (c) c.innerHTML = "";
      }
    }
  } else {
    const summary = document.querySelector("#packageCreditSummary");
    if (summary) summary.style.display = "none";
    const c = document.querySelector("#packageCreditsContainer");
    if (c) c.innerHTML = "";
  }

  updateFinalPreview();
}

function openClient(clientId = "") {
  const client = state.clientes.find((c) => c.id === clientId);
  document.querySelector("#clientId").value = client?.id || "";
  document.querySelector("#clientName").value = client?.nome || "";
  document.querySelector("#clientPhone").value = client?.telefone || "";
  document.querySelector("#clientNotes").value = client?.observacoes || "";
  document.querySelector("#deleteClient").style.visibility = client ? "visible" : "hidden";
  document.querySelector("#clientModal").showModal();
}

function openService(serviceId = "") {
  const service = state.servicos.find((s) => s.id === serviceId);
  document.querySelector("#serviceId").value = service?.id || "";
  document.querySelector("#serviceName").value = service?.nome || "";
  document.querySelector("#servicePrice").value = service?.valorPadrao ?? "";
  document.querySelector("#serviceDuration").value = service?.duracaoMinutos || 60;
  document.querySelector("#serviceActive").checked = service?.ativo ?? true;
  document.querySelector("#deleteService").style.visibility = service ? "visible" : "hidden";
  document.querySelector("#serviceModal").showModal();
}

function openPackage(packageId = "") {
  fillSelects();
  const pacote = state.pacotes.find((item) => item.id === packageId);
  document.querySelector("#packageId").value = pacote?.id || "";
  document.querySelector("#packageClient").value = pacote?.clienteId || "";
  document.querySelector("#packageName").value = pacote?.nome || "Pacote mensal";
  document.querySelector("#packageValue").value = pacote?.valorPago ?? "";
  renderPackageServiceFields(pacote);
  document.querySelector("#packageExpires").value = pacote?.validade || "";
  document.querySelector("#deletePackage").style.visibility = pacote ? "visible" : "hidden";

  // Mostrar botão cancelar só para pacotes ativos existentes
  const cancelBtn = document.querySelector("#cancelPackageBtn");
  if (cancelBtn) cancelBtn.style.display = (pacote && pacote.status === "ativo") ? "inline-flex" : "none";

  // Mostrar histórico se editar pacote existente
  if (pacote) {
    renderPackageHistory(pacote.id);
  } else {
    const section = document.querySelector("#packageHistorySection");
    if (section) section.style.display = "none";
  }

  document.querySelector("#packageModal").showModal();
}

function openAppointment(appointmentId = "") {
  fillSelects();
  const item = state.agendamentos.find((a) => a.id === appointmentId);
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(now.getTime() + 60 * 60 * 1000);

  // 1. Campos simples
  document.querySelector("#appointmentId").value = item?.id || "";
  document.querySelector("#appointmentStart").value = item?.dataHoraInicio || toDateTimeInput(now);
  document.querySelector("#appointmentEnd").value = item?.dataHoraFim || toDateTimeInput(end);
  document.querySelector("#appointmentPrice").value = item?.valorServico ?? "";
  document.querySelector("#discountType").value = "nenhum";
  document.querySelector("#discountValue").value = 0;
  document.querySelector("#appointmentPaymentMethod").value = item?.formaPagamento || "";
  document.querySelector("#appointmentPaymentStatus").value = item?.statusPagamento || "pendente";
  document.querySelector("#appointmentPaymentDiscountType").value = item?.descontoPagamentoTipo || "nenhum";
  document.querySelector("#appointmentPaymentDiscountValue").value = item?.descontoPagamentoValor ?? 0;
  document.querySelector("#appointmentStatus").value = item?.status || "Agendado";
  document.querySelector("#appointmentNotes").value = item?.observacoes || "";
  document.querySelector("#deleteAppointment").style.visibility = item ? "visible" : "hidden";

  // 2. Cliente — setar antes de fillAppointmentPackages
  document.querySelector("#appointmentClient").value = item?.clienteId || "";

  // 3. Modo pacote — setar o checkbox ANTES de chamar fillAppointmentPackages
  const usarPacote = Boolean(item?.usarPacote);
  document.querySelector("#usePackage").checked = usarPacote;

  // 4. Preencher lista de pacotes disponíveis para a cliente
  // preserveChecked=true: não resetar o checkbox nem chamar updatePackageModeFields internamente,
  // pois já fizemos isso na ordem correta aqui
  fillAppointmentPackages(true);

  // 5. Restaurar valor do select de pacote (após fillAppointmentPackages que recria as options)
  if (usarPacote && item?.pacoteId) {
    document.querySelector("#appointmentPackage").value = item.pacoteId;
  }

  // 6. Restaurar serviços ou créditos do pacote
  if (usarPacote && item?.pacoteId) {
    // Reconstruir créditos: novo formato (creditosConsumidos) ou legado (servicoCreditoPacoteId)
    let existingCredits = [];
    if (Array.isArray(item.creditosConsumidos) && item.creditosConsumidos.length) {
      existingCredits = item.creditosConsumidos.map((c) => ({
        servicoId: c.servicoId,
        qty: c.qty || 1,
      }));
    } else if (item.servicoCreditoPacoteId || item.tipoCreditoPacote) {
      existingCredits = [{
        servicoId: item.servicoCreditoPacoteId || item.tipoCreditoPacote,
        qty: 1,
      }];
    }
    renderPackageCreditLines(item.pacoteId, existingCredits.filter((c) => c.servicoId));
  } else {
    // Restaurar lista de serviços normais
    let serviceIds = [];
    if (Array.isArray(item?.servicos) && item.servicos.length) {
      serviceIds = item.servicos.map((s) => s.id).filter(Boolean);
    } else if (item?.servicoId) {
      serviceIds = [item.servicoId];
      if (item.servicoId2) serviceIds.push(item.servicoId2);
    }
    renderServiceLines(serviceIds.length ? serviceIds : [""]);
  }

  // 7. Atualizar visibilidade dos campos com base no modo (pacote vs serviço)
  // skipCreditRender=true: os créditos já foram renderizados no passo 6
  updatePackageModeFields(true);
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

function openPaymentModal(appointmentId, afterSave = null) {
  const appointment = state.agendamentos.find((item) => item.id === appointmentId);
  if (!appointment) return;
  afterPaymentSaveCallback = typeof afterSave === "function" ? afterSave : null;
  document.querySelector("#paymentAppointmentId").value = appointment.id;
  document.querySelector("#paymentMethod").value = appointment.formaPagamento || "";
  document.querySelector("#paymentStatus").value = appointment.statusPagamento || "pendente";
  document.querySelector("#paymentDiscountType").value = appointment.descontoPagamentoTipo || "nenhum";
  document.querySelector("#paymentDiscountValue").value = appointment.descontoPagamentoValor ?? 0;
  document.querySelector("#paymentDate").value = appointment.dataPagamento || toDateInput(new Date());
  document.querySelector("#paymentNotes").value = appointment.observacoesPagamento || "";
  document.querySelector("#paymentSummary").innerHTML = `
    <strong>${escapeHtml(appointment.nomeCliente)}</strong>
    <span>${escapeHtml(appointmentServiceName(appointment))}</span>
    <span>Valor bruto: <strong>${money(appointment.valorFinal)}</strong></span>
  `;
  updatePaymentPreview();
  document.querySelector("#paymentModal").showModal();
}

function updatePaymentDiscountVisibility(prefix = "payment") {
  const method = document.querySelector(`#${prefix}Method`)?.value || "";
  const field = document.querySelector(`#${prefix}DiscountFields`);
  if (!field) return;
  field.classList.toggle("hidden", method !== "dinheiro" && method !== "pix");
}

function updatePaymentPreview() {
  const appointmentId = document.querySelector("#paymentAppointmentId")?.value;
  const appointment = state.agendamentos.find((item) => item.id === appointmentId);
  const method = document.querySelector("#paymentMethod")?.value || "";
  const discountType = document.querySelector("#paymentDiscountType")?.value || "nenhum";
  const discountValue = document.querySelector("#paymentDiscountValue")?.value || 0;
  const preview = document.querySelector("#paymentPreview");
  if (!appointment || !preview) return;
  updatePaymentDiscountVisibility("payment");
  const { rate, taxAmount, discountAmount, netValue } = calculatePaymentValues(appointment.valorFinal, method, discountType, discountValue);
  if (!method) {
    preview.innerHTML = `Líquido previsto: <strong>${money(netValue)}</strong>`;
    return;
  }
  const detail = method === "dinheiro" || method === "pix"
    ? `desconto: <strong>${money(discountAmount)}</strong>`
    : `taxa: <strong>${rate.toFixed(2)}%</strong> · taxa banco: <strong>${money(taxAmount)}</strong>`;
  preview.innerHTML = `${detail} · líquido: <strong>${money(netValue)}</strong>`;
}

function updateAppointmentPaymentPreview() {
  const method = document.querySelector("#appointmentPaymentMethod")?.value || "";
  const statusSelect = document.querySelector("#appointmentPaymentStatus");
  if (statusSelect && method && statusSelect.value === "pendente") statusSelect.value = "pago";
  if (statusSelect && !method) statusSelect.value = "pendente";
  const preview = document.querySelector("#appointmentPaymentPreview");
  if (!preview) return;
  updatePaymentDiscountVisibility("appointmentPayment");
  const grossValue = calculateFinalValue(
    document.querySelector("#appointmentPrice").value,
    document.querySelector("#discountType").value,
    document.querySelector("#discountValue").value,
  );
  const { rate, taxAmount, discountAmount, netValue } = calculatePaymentValues(
    grossValue,
    method,
    document.querySelector("#appointmentPaymentDiscountType")?.value || "nenhum",
    document.querySelector("#appointmentPaymentDiscountValue")?.value || 0,
  );
  if (!method) {
    preview.innerHTML = `Pagamento pendente · líquido previsto: <strong>${money(grossValue)}</strong>`;
    return;
  }
  const detail = method === "dinheiro" || method === "pix"
    ? `desconto no pagamento: <strong>${money(discountAmount)}</strong>`
    : `taxa: <strong>${rate.toFixed(2)}%</strong> · taxa banco: <strong>${money(taxAmount)}</strong>`;
  preview.innerHTML = `${detail} · líquido: <strong>${money(netValue)}</strong>`;
}

function savePaymentAndClose() {
  const appointmentId = document.querySelector("#paymentAppointmentId").value;
  const appointment = state.agendamentos.find((item) => item.id === appointmentId);
  if (!appointment) return;
  const method = document.querySelector("#paymentMethod").value;
  const statusPagamento = document.querySelector("#paymentStatus").value;
  const descontoPagamentoTipo = document.querySelector("#paymentDiscountType").value;
  const descontoPagamentoValor = Number(document.querySelector("#paymentDiscountValue").value || 0);
  const dataPagamento = document.querySelector("#paymentDate").value || toDateInput(new Date());
  const observacoesPagamento = document.querySelector("#paymentNotes").value.trim();

  if (statusPagamento === "pago" && !method) {
    toast("Selecione a forma de pagamento.");
    return;
  }

  const { rate, taxAmount, discountAmount, grossValue, netValue } = calculatePaymentValues(appointment.valorFinal, method, descontoPagamentoTipo, descontoPagamentoValor);
  appointment.formaPagamento = statusPagamento === "pago" ? method : "";
  appointment.statusPagamento = statusPagamento;
  appointment.taxaPercentual = rate;
  appointment.valorTaxa = taxAmount;
  appointment.descontoPagamentoTipo = method === "dinheiro" || method === "pix" ? descontoPagamentoTipo : "nenhum";
  appointment.descontoPagamentoValor = method === "dinheiro" || method === "pix" ? descontoPagamentoValor : 0;
  appointment.valorDescontoPagamento = discountAmount;
  appointment.valorBruto = grossValue;
  appointment.valorLiquido = netValue;
  appointment.dataPagamento = dataPagamento;
  appointment.observacoesPagamento = observacoesPagamento;
  const financeAction = syncAppointmentFinance(appointment);
  const callback = afterPaymentSaveCallback;
  afterPaymentSaveCallback = null;
  if (callback) callback(appointment);
  save();
  renderAll();
  document.querySelector("#paymentModal").close();
  if (financeAction === "created") toast("Pagamento registrado e entrada financeira criada.");
  else if (financeAction === "updated") toast("Pagamento atualizado no financeiro.");
  else if (financeAction === "removed") toast("Pagamento marcado como pendente e financeiro removido.");
  else toast(`Pagamento ${statusPagamento === "pago" ? "registrado" : "marcado como pendente"}.`);
}

function updateAppointmentStatus(appointmentId, status) {
  const appointment = state.agendamentos.find((a) => a.id === appointmentId);
  if (!appointment) return;
  const previousStatus = appointment.status;
  if (status === "Concluído" && appointment.usarPacote && appointment.pacoteId && packageAvailability(appointment.pacoteId, appointment.servicoCreditoPacoteId || appointment.tipoCreditoPacote, appointment.id) <= 0) {
    renderAppointments();
    toast(`Este pacote não tem crédito disponível de ${packageCreditLabel(appointment.servicoCreditoPacoteId || appointment.tipoCreditoPacote)}.`);
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
  recomputePackageUsage();
  save();
  renderAll();
  toast("Status atualizado.");
  if (appointment.origemCliente && previousStatus === "Pendente confirmação" && status === "Confirmado") {
    sendAppointmentWhatsapp(appointment.id, "confirmacao");
  }
}

function sendAppointmentWhatsapp(appointmentId, mode = "comprovante") {
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
  const paymentLabel = appointment.usarPacote
    ? `Pacote pré-pago - ${packageCreditLabel(appointment.servicoCreditoPacoteId || appointment.tipoCreditoPacote)}`
    : appointment.statusPagamento === "pago" ? "Pago" : "Pendente";
  const message =
    mode === "confirmacao"
      ? [
          `Olá, ${appointment.nomeCliente}!`,
          "",
          "Seu agendamento foi confirmado:",
          `Empresa: ${companyName()}`,
          `Serviço: ${appointmentServiceName(appointment)}`,
          `Data: ${start.toLocaleDateString("pt-BR")}`,
          `Chegada: ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} com 15 minutos de tolerância para atraso`,
          `Saída: ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
          `Valor: ${appointment.usarPacote ? "Pacote pré-pago" : money(appointment.valorFinal)}`,
          "",
          "Obrigada pela preferência!",
        ].join("\n")
      : [
          `Olá, ${appointment.nomeCliente}!`,
          "",
          "Segue seu comprovante de agendamento:",
          `Empresa: ${companyName()}`,
          `Serviço: ${appointmentServiceName(appointment)}`,
          `Data: ${start.toLocaleDateString("pt-BR")}`,
          `Chegada: ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} com 15 minutos de tolerância para atraso`,
          `Saída: ${end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
          `Valor: ${appointment.usarPacote ? "Pacote pré-pago" : money(appointment.valorFinal)}`,
          `Pagamento: ${paymentLabel}`,
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
  updateAppointmentPaymentPreview();
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
  return normalize(status).replace("í", "i").replace(/\s+/g, "-");
}

function isAppointmentLate(appointment) {
  return ["Agendado", "Confirmado"].includes(appointment.status) && parseDate(appointment.dataHoraInicio) < new Date();
}

function getStatusIcon(appointment) {
  if (appointment.status === "Cancelado") return "⚫";
  if (appointment.status === "Pendente confirmação") return "🔵";
  if (isAppointmentLate(appointment)) return "🔴";
  if (appointment.statusPagamento === "pago") return "🟢";
  if (appointment.status === "Concluído" && appointment.statusPagamento === "pendente") return "🔴";
  if (appointment.status === "Agendado") return "🟡";
  if (appointment.status === "Confirmado") return "🟠";
  return "⚪";
}

function paymentStatusLabel(appointment) {
  if (appointment.usarPacote) return "Pacote pré-pago";
  return appointment.statusPagamento === "pago"
    ? `Pago${appointment.formaPagamento ? ` · ${paymentMethodLabel(appointment.formaPagamento)}` : ""}`
    : "Pagamento pendente";
}

function paymentMethodLabel(method) {
  return {
    dinheiro: "Dinheiro",
    pix: "Pix",
    debito: "Cartão débito",
    credito: "Cartão crédito",
  }[method] || "";
}

function updatePaymentAlert() {
  const alertDiv = document.querySelector("#paymentAlertBar");
  const alertMessage = document.querySelector("#alertMessage");
  if (!alertDiv || !alertMessage) return;
  const alerts = state.agendamentos
    .filter((appointment) => {
      const pendingConfirmation = appointment.status === "Pendente confirmação";
      const paymentPending = appointment.status === "Concluído" && appointment.statusPagamento === "pendente";
      const appointmentLate = isAppointmentLate(appointment);
      return pendingConfirmation || paymentPending || appointmentLate;
    })
    .sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));

  if (!alerts.length) {
    alertDiv.style.display = "none";
    alertMessage.innerHTML = "";
    return;
  }

  alertMessage.innerHTML = alerts
    .map((appointment) => {
      const text = appointment.status === "Pendente confirmação"
        ? `🔵 ${appointment.nomeCliente} - aguardando confirmação (${parseDate(appointment.dataHoraInicio).toLocaleDateString("pt-BR")} ${parseDate(appointment.dataHoraInicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`
        : isAppointmentLate(appointment)
          ? `⏰ ${appointment.nomeCliente} - agendamento atrasado (${parseDate(appointment.dataHoraInicio).toLocaleDateString("pt-BR")} ${parseDate(appointment.dataHoraInicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`
          : `⚠️ ${appointment.nomeCliente} - pagamento pendente`;
      return `<button type="button" data-edit-appointment="${appointment.id}">${escapeHtml(text)}</button>`;
    })
    .join(`<span class="alert-separator">|</span>`);
  alertDiv.style.display = "block";
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
      clienteAtivo: true,
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
    const selectedCredits = readPackageCredits();
    const payload = {
      id: packageId || id(),
      clienteId: client.id,
      nomeCliente: client.nome,
      nome: document.querySelector("#packageName").value.trim(),
      valorPago: Number(document.querySelector("#packageValue").value),
      creditos: selectedCredits,
      validade: document.querySelector("#packageExpires").value,
      dataCompra: new Date().toISOString(),
      status: "ativo",
      dataCadastro: new Date().toISOString(),
    };
    if (payload.valorPago <= 0) return toast("Informe o valor pago do pacote.");
    if (!payload.creditos.length) return toast("Selecione ao menos um serviço com créditos no pacote.");

    const existing = state.pacotes.find((item) => item.id === packageId);
    if (existing) {
      payload.dataCompra = existing.dataCompra;
      payload.dataCadastro = existing.dataCadastro;
      payload.creditos = payload.creditos.map((credit) => ({
        ...credit,
        usado: existing.creditos?.find((item) => item.servicoId === credit.servicoId)?.usado || 0,
      }));
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
    const sendWhatsappAfterSave = event.submitter?.id === "saveAppointmentWhatsapp";
    const appointmentId = document.querySelector("#appointmentId").value;
    const client = state.clientes.find((c) => c.id === document.querySelector("#appointmentClient").value);
    const usarPacote = document.querySelector("#usePackage").checked;
    const pacoteId = document.querySelector("#appointmentPackage").value;
    const start = document.querySelector("#appointmentStart").value;
    const end   = document.querySelector("#appointmentEnd").value;

    if (!client) return toast("Selecione a cliente.");
    if (parseDate(end) <= parseDate(start)) return toast("O fim precisa ser depois do início.");

    /* ─── MODO PACOTE ─────────────────────────────────────── */
    let creditosConsumidos = []; // novo formato: [{ servicoId, qty }]
    let servicoCreditoPacoteId = ""; // compat legado
    let nomeServico = "";

    if (usarPacote) {
      if (!pacoteId) return toast("Selecione o pacote da cliente.");

      const lines = readPackageCreditLines().filter((l) => l.servicoId && l.qty > 0);
      if (!lines.length) return toast("Selecione ao menos um crédito do pacote.");

      // Validar disponibilidade de cada crédito
      for (const line of lines) {
        const disponivel = packageAvailability(pacoteId, line.servicoId, appointmentId);
        if (document.querySelector("#appointmentStatus").value === "Concluído" && disponivel < line.qty) {
          return toast(`Créditos insuficientes de "${packageCreditLabel(line.servicoId)}" — disponível: ${disponivel}, solicitado: ${line.qty}.`);
        }
      }

      creditosConsumidos = lines;
      servicoCreditoPacoteId = lines[0].servicoId; // compat legado
      nomeServico = lines.map((l) => packageCreditLabel(l.servicoId)).join(" + ");
    }

    /* ─── MODO SERVIÇO NORMAL ─────────────────────────────── */
    let servicos = []; // novo formato: [{ id, nome, valor, duracao }]
    let valorTotal = 0;

    if (!usarPacote) {
      const selectedServices = getSelectedServiceLines();
      if (!selectedServices.length) return toast("Selecione ao menos um serviço.");
      servicos = selectedServices.map((s) => ({
        id: s.id,
        nome: s.nome,
        valor: Number(s.valorPadrao || 0),
        duracaoMinutos: Number(s.duracaoMinutos || 0),
      }));
      valorTotal = Number(document.querySelector("#appointmentPrice").value) || servicos.reduce((sum, s) => sum + s.valor, 0);
      if (valorTotal <= 0) return toast("Agendamento precisa ter valor.");

      const paymentMethod = document.querySelector("#appointmentPaymentMethod").value;
      const appointmentPaymentStatus = document.querySelector("#appointmentPaymentStatus").value;
      if (appointmentPaymentStatus === "pago" && !paymentMethod) return toast("Selecione a forma de pagamento.");
    }

    const paymentMethod = usarPacote ? "" : document.querySelector("#appointmentPaymentMethod").value;
    const appointmentPaymentStatus = usarPacote ? "pago" : document.querySelector("#appointmentPaymentStatus").value;
    const paymentDiscountType  = document.querySelector("#appointmentPaymentDiscountType").value;
    const paymentDiscountValue = Number(document.querySelector("#appointmentPaymentDiscountValue").value || 0);

    // Nome do serviço para exibição (compatibilidade legada)
    const primeiroServico = servicos[0];
    if (!usarPacote) nomeServico = servicos.map((s) => s.nome).join(" + ");

    const existing = state.agendamentos.find((a) => a.id === appointmentId);
    const payload = {
      id: appointmentId || id(),
      clienteId: client.id,
      nomeCliente: client.nome,
      telefone: client.telefone,
      // Novo formato de serviços
      servicos: usarPacote ? [] : servicos,
      creditosConsumidos: usarPacote ? creditosConsumidos : [],
      // Campos legados (compatibilidade)
      servicoId:  usarPacote ? servicoCreditoPacoteId : (primeiroServico?.id || ""),
      nomeServico: nomeServico,
      servicoId2: servicos[1]?.id || "",
      nomeServico2: servicos[1]?.nome || "",
      valorServico: usarPacote ? 0 : valorTotal,
      descontoTipo: "nenhum",
      descontoValor: 0,
      valorFinal: usarPacote ? 0 : valorTotal,
      dataHoraInicio: start,
      dataHoraFim: end,
      status: document.querySelector("#appointmentStatus").value,
      observacoes: document.querySelector("#appointmentNotes").value.trim(),
      origemCliente: existing?.origemCliente || false,
      clienteAuthUid: existing?.clienteAuthUid || "",
      emailCliente: existing?.emailCliente || "",
      usarPacote,
      pacoteId: usarPacote ? pacoteId : "",
      servicoCreditoPacoteId: usarPacote ? servicoCreditoPacoteId : "",
      tipoCreditoPacote: usarPacote ? servicoCreditoPacoteId : "",
      formaPagamento: appointmentPaymentStatus === "pago" ? paymentMethod : "",
      statusPagamento: appointmentPaymentStatus,
      taxaPercentual: existing?.taxaPercentual || 0,
      valorTaxa: existing?.valorTaxa || 0,
      descontoPagamentoTipo: paymentMethod === "dinheiro" || paymentMethod === "pix" ? paymentDiscountType : "nenhum",
      descontoPagamentoValor: paymentMethod === "dinheiro" || paymentMethod === "pix" ? paymentDiscountValue : 0,
      valorDescontoPagamento: existing?.valorDescontoPagamento || 0,
      valorBruto: usarPacote ? 0 : valorTotal,
      valorLiquido: usarPacote ? 0 : (existing?.valorLiquido ?? valorTotal),
      dataPagamento: usarPacote ? toDateInput(start) : appointmentPaymentStatus === "pago" ? existing?.dataPagamento || toDateInput(new Date()) : "",
      observacoesPagamento: existing?.observacoesPagamento || "",
      financeiroGerado: existing?.financeiroGerado || false,
      dataCadastro: existing?.dataCadastro || new Date().toISOString(),
    };

    const conflict = getScheduleConflict(payload);
    if (conflict) { showConflictDialog(conflict); return; }

    let savedAppointment = payload;
    if (appointmentId) {
      Object.assign(existing, payload);
      savedAppointment = existing;
    } else {
      state.agendamentos.push(payload);
    }

    if (savedAppointment.statusPagamento === "pago" && !savedAppointment.usarPacote) {
      const pv = calculatePaymentValues(savedAppointment.valorFinal, savedAppointment.formaPagamento, savedAppointment.descontoPagamentoTipo, savedAppointment.descontoPagamentoValor);
      savedAppointment.taxaPercentual = pv.rate;
      savedAppointment.valorTaxa = pv.taxAmount;
      savedAppointment.valorDescontoPagamento = pv.discountAmount;
      savedAppointment.valorBruto = pv.grossValue;
      savedAppointment.valorLiquido = pv.netValue;
    } else if (!savedAppointment.usarPacote) {
      resetAppointmentPayment(savedAppointment);
    }

    syncAppointmentFinance(savedAppointment);
    recomputePackageUsage();
    save();
    document.querySelector("#appointmentModal").close();
    renderAll();
    toast("Agendamento salvo.");
    if (sendWhatsappAfterSave) {
      sendAppointmentWhatsapp(savedAppointment.id, savedAppointment.status === "Confirmado" ? "confirmacao" : "comprovante");
    }
  });

  document.querySelector("#financeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const financeId = document.querySelector("#financeId").value;
    const existingFinance = state.financeiro.find((f) => f.id === financeId);
    if (financeId && !existingFinance) return toast("Lançamento financeiro não encontrado.");
    const payload = {
      id: financeId || id(),
      tipo: document.querySelector("#financeEntryType").value,
      descricao: document.querySelector("#financeDescription").value.trim(),
      categoria: document.querySelector("#financeCategory").value.trim(),
      valor: Number(document.querySelector("#financeValue").value),
      data: document.querySelector("#financeDate").value,
      origem: existingFinance?.origem || "manual",
      agendamentoId: existingFinance?.agendamentoId || "",
      pacoteId: existingFinance?.pacoteId || "",
      dataCadastro: existingFinance?.dataCadastro || new Date().toISOString(),
    };
    if (financeId) Object.assign(existingFinance, payload);
    else state.financeiro.push(payload);
    syncAppointmentFromFinance(payload);
    save();
    document.querySelector("#financeModal").close();
    renderAll();
    toast("Lançamento salvo.");
  });

  document.querySelector("#paymentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    savePaymentAndClose();
  });

  document.querySelector("#adminForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.companyName = document.querySelector("#settingCompanyName").value.trim() || DEFAULT_SETTINGS.companyName;
    state.settings.subtitle = document.querySelector("#settingSubtitle").value.trim() || DEFAULT_SETTINGS.subtitle;
    state.settings.telefoneContato = (document.querySelector("#settingTelefoneContato")?.value || "").trim();
    state.settings.instagram = (document.querySelector("#settingInstagram")?.value || "").trim();
    state.settings.logoText = document.querySelector("#settingLogoText").value.trim() || state.settings.companyName.slice(0, 1).toUpperCase();
    state.settings.colors.green = document.querySelector("#settingGreen").value;
    state.settings.colors.greenDark = document.querySelector("#settingGreenDark").value;
    state.settings.colors.beige = document.querySelector("#settingBeige").value;
    state.settings.colors.ink = document.querySelector("#settingInk").value;
    state.settings.colors.alert = document.querySelector("#settingAlert").value;
    state.settings.taxas = {
      debito: Number(document.querySelector("#taxaDebito").value || 0),
      credito: Number(document.querySelector("#taxaCredito").value || 0),
    };
    state.settings.openingTime = document.querySelector("#settingOpeningTime").value;
    state.settings.closingTime = document.querySelector("#settingClosingTime").value;
    state.settings.lunchStart = document.querySelector("#settingLunchStart").value;
    state.settings.lunchEnd = document.querySelector("#settingLunchEnd").value;
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
    if (password && password.length < 6) {
      toast("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (!employeeId && password.length < 6) {
      toast("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

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
        await saveLoginAliases(username, name, email);
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
        await saveLoginAliases(username, name, email);
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
    const paymentButton = event.target.closest("[data-payment-appointment]");
    if (paymentButton) openPaymentModal(paymentButton.dataset.paymentAppointment);
    const whatsappButton = event.target.closest("[data-whatsapp-appointment]");
    if (whatsappButton) sendAppointmentWhatsapp(whatsappButton.dataset.whatsappAppointment);
    const deletePackageButton = event.target.closest("[data-delete-package]");
    if (deletePackageButton) deletePackage(deletePackageButton.dataset.deletePackage);
  });

  document.querySelector("#openClientModal").addEventListener("click", () => openClient());
  document.querySelector("#openServiceModal").addEventListener("click", () => openService());
  document.querySelector("#openAppointmentModal").addEventListener("click", () => openAppointment());
  document.querySelector("#quickAppointment").addEventListener("click", () => openAppointment());
  // Botão + Adicionar serviço no modal de agendamento
  document.querySelector("#addServiceLine")?.addEventListener("click", addServiceLine);
  // Botão cancelar pacote no modal
  document.querySelector("#cancelPackageBtn")?.addEventListener("click", () => {
    const packageId = document.querySelector("#packageId").value;
    if (packageId) {
      document.querySelector("#packageModal").close();
      cancelPackage(packageId);
    }
  });
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
  document.querySelector("#mobileMoreButton")?.addEventListener("click", () => {
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
    if (!appointmentId) return;
    if (!confirm("Excluir este agendamento? Lançamentos financeiros vinculados também serão removidos.")) return;
    deleteAppointmentById(appointmentId);
    recomputePackageUsage();
    save();
    document.querySelector("#appointmentModal").close();
    renderAll();
    toast("Agendamento excluído.");
  });

  document.querySelector("#deleteClient").addEventListener("click", () => {
    const clientId = document.querySelector("#clientId").value;
    if (!clientId) return;
    if (!confirm("Excluir cliente? Agendamentos passados serão mantidos, apenas cliente será removido da lista.")) return;
    const client = state.clientes.find((item) => item.id === clientId);
    if (client) client.clienteAtivo = false;
    state.pacotes
      .filter((pacote) => pacote.clienteId === clientId && pacote.status !== "finalizado")
      .forEach((pacote) => {
        pacote.status = "excluido";
      });
    save();
    document.querySelector("#clientModal").close();
    renderAll();
    toast("Cliente removido da lista.");
  });

  document.querySelector("#deleteService").addEventListener("click", () => {
    const serviceId = document.querySelector("#serviceId").value;
    if (!serviceId) return;
    if (!confirm("Excluir serviço? Agendamentos antigos serão mantidos com o nome do serviço.")) return;
    const linkedAppointments = state.agendamentos.filter((appointment) => appointment.servicoId === serviceId || appointment.servicoId2 === serviceId);
    if (linkedAppointments.length && confirm(`Este serviço tem ${linkedAppointments.length} agendamento(s) vinculado(s). Deseja excluir esses agendamentos também? Clique em Cancelar para manter os agendamentos.`)) {
      linkedAppointments.forEach((appointment) => deleteAppointmentById(appointment.id));
    }
    const service = state.servicos.find((item) => item.id === serviceId);
    if (service) service.ativo = false;
    save();
    document.querySelector("#serviceModal").close();
    renderAll();
    toast("Serviço removido da lista.");
  });

  document.querySelector("#deletePackage").addEventListener("click", () => {
    const packageId = document.querySelector("#packageId").value;
    if (packageId) deletePackage(packageId, true);
  });

  document.querySelector("#deleteFinance").addEventListener("click", () => {
    const financeId = document.querySelector("#financeId").value;
    const entry = state.financeiro.find((item) => item.id === financeId);
    if (!entry) return;
    if (entry.origem === "agendamento" && entry.agendamentoId) {
      if (!confirm("Este lançamento está ligado a um agendamento. Excluir o lançamento vai marcar o pagamento do agendamento como pendente. Deseja continuar?")) return;
      const appointment = state.agendamentos.find((item) => item.id === entry.agendamentoId);
      if (appointment) resetAppointmentPayment(appointment);
    }
    if (entry.origem === "pacote" && entry.pacoteId) {
      if (!confirm("Este lançamento está ligado a um pacote. Deseja excluir o pacote junto com o financeiro?")) return;
      const linkedAppointments = state.agendamentos.filter((appointment) => appointment.pacoteId === entry.pacoteId);
      const removeLinked = linkedAppointments.length
        ? confirm(`Este pacote tem ${linkedAppointments.length} agendamento(s) vinculado(s). Deseja excluir esses agendamentos também? Clique em Cancelar para manter os agendamentos e remover apenas o vínculo.`)
        : false;
      state.pacotes = state.pacotes.filter((pacote) => pacote.id !== entry.pacoteId);
      if (removeLinked) linkedAppointments.forEach((appointment) => deleteAppointmentById(appointment.id));
      else {
        linkedAppointments.forEach((appointment) => {
          appointment.pacoteId = "";
          appointment.usarPacote = false;
          resetAppointmentPayment(appointment);
        });
      }
    }
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
  document.querySelector("#logoutBtn")?.addEventListener("click", handleLogout);
  document.querySelector("#paymentMethod").addEventListener("input", updatePaymentPreview);
  document.querySelector("#paymentStatus").addEventListener("input", updatePaymentPreview);
  document.querySelector("#paymentDiscountType").addEventListener("input", updatePaymentPreview);
  document.querySelector("#paymentDiscountValue").addEventListener("input", updatePaymentPreview);

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

  ["agendaMonth", "agendaStatus", "agendaSearch", "clientSearch", "serviceSearch", "packageSearch", "financeMonth", "financeType", "dashboardPeriod", "packageStatusFilter"].forEach((idName) => {
    document.querySelector(`#${idName}`)?.addEventListener("input", renderAll);
  });

  ["appointmentPrice", "discountType", "discountValue", "appointmentPaymentMethod", "appointmentPaymentDiscountType", "appointmentPaymentDiscountValue", "appointmentPaymentStatus"].forEach((idName) => {
    document.querySelector(`#${idName}`).addEventListener("input", updateFinalPreview);
  });

  document.querySelector("#appointmentStart").addEventListener("input", () => {
    if (!document.querySelector("#usePackage")?.checked) recalcFromServices();
  });
  document.querySelector("#appointmentClient").addEventListener("change", fillAppointmentPackages);
  document.querySelector("#usePackage").addEventListener("change", () => {
    fillAppointmentPackages();
    updatePackageModeFields();
    if (!document.querySelector("#usePackage").checked) renderServiceLines([""]);
  });
  document.querySelector("#appointmentPackage").addEventListener("change", () => {
    const pacoteId = document.querySelector("#appointmentPackage").value;
    if (pacoteId) renderPackageCreditLines(pacoteId);
  });
  ["settingCompanyName", "settingSubtitle", "settingLogoText", "settingGreen", "settingGreenDark", "settingBeige", "settingInk", "settingAlert", "taxaDebito", "taxaCredito", "settingOpeningTime", "settingClosingTime", "settingLunchStart", "settingLunchEnd"].forEach((idName) => {
    document.querySelector(`#${idName}`).addEventListener("input", () => {
      state.settings.companyName = document.querySelector("#settingCompanyName").value;
      state.settings.subtitle = document.querySelector("#settingSubtitle").value;
      state.settings.logoText = document.querySelector("#settingLogoText").value;
      state.settings.colors.green = document.querySelector("#settingGreen").value;
      state.settings.colors.greenDark = document.querySelector("#settingGreenDark").value;
      state.settings.colors.beige = document.querySelector("#settingBeige").value;
      state.settings.colors.ink = document.querySelector("#settingInk").value;
      state.settings.colors.alert = document.querySelector("#settingAlert").value;
      state.settings.taxas = {
        debito: Number(document.querySelector("#taxaDebito").value || 0),
        credito: Number(document.querySelector("#taxaCredito").value || 0),
      };
      state.settings.openingTime = document.querySelector("#settingOpeningTime").value;
      state.settings.closingTime = document.querySelector("#settingClosingTime").value;
      state.settings.lunchStart = document.querySelector("#settingLunchStart").value;
      state.settings.lunchEnd = document.querySelector("#settingLunchEnd").value;
      applySettings(true);
      document.querySelector("#adminNamePreview").textContent = document.querySelector("#settingCompanyName").value || DEFAULT_SETTINGS.companyName;
      document.querySelector("#adminSubtitlePreview").textContent = document.querySelector("#settingSubtitle").value || DEFAULT_SETTINGS.subtitle;
    });
  });
}

function exportCsv() {
  const rows = [
    ["tipo", "descricao", "categoria", "valor", "data", "origem"],
    ...state.financeiro.map((f) => [f.tipo, f.descricao, f.categoria, f.valor, f.data, f.origem]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  download(`financeiro-${brandSlug()}-${toDateInput(new Date())}.csv`, csv, "text/csv;charset=utf-8");
}

function exportBackup() {
  const backup = {
    app: `${companyName()} Gestão`,
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      clientes: state.clientes,
      settings: state.settings,
      servicos: state.servicos,
      agendamentos: state.agendamentos,
      pacotes: state.pacotes,
      financeiro: state.financeiro,
      landingContent: state.landingContent || {},
    },
  };
  download(`backup-${brandSlug()}-${toDateInput(new Date())}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
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
      state.landingContent = data.landingContent || {};
      migrateState();
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
    <html><head><title>${escapeHtml(companyName())} - Relatório financeiro</title><style>
      body{font-family:Arial,sans-serif;padding:32px;color:#2b2b2b}
      h1{color:#2f4f3a} table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}
      .summary{display:flex;gap:16px;margin:18px 0}.summary div{border:1px solid #ddd;padding:12px;border-radius:8px}
    </style></head><body>
      <h1>${escapeHtml(companyName())} - Relatório financeiro</h1>
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

const DEFAULT_LANDING_CONTENT = {
  heroEyebrow: "Nail design, alongamento e cuidado",
  heroTitle: "Rayssa Oliveira Nail Design",
  heroDescription: "Unhas feitas com acabamento delicado, planejamento do formato e orientacao de cuidados para manter o resultado bonito por mais tempo.",
  heroImage: "assets/site/hero-placeholder.svg",
  highlight1Title: "Atendimento personalizado",
  highlight1Text: "Escolha de formato, tamanho, cor e acabamento conforme seu estilo.",
  highlight2Title: "Procedimento orientado",
  highlight2Text: "Preparacao, aplicacao e finalizacao com explicacao dos cuidados.",
  highlight3Title: "Manutencao planejada",
  highlight3Text: "Recomendacoes para preservar brilho, estrutura e durabilidade.",
  servicesEyebrow: "Servicos realizados",
  servicesTitle: "Procedimentos para diferentes estilos de unha",
  service1Title: "Alongamento em gel",
  service1Text: "Estrutura resistente, acabamento natural e formato definido para quem busca durabilidade.",
  service2Title: "Banho de gel",
  service2Text: "Camada de protecao para fortalecer a unha natural e manter o brilho da esmaltação.",
  service3Title: "Blindagem",
  service3Text: "Ideal para unhas fracas, com finalizacao fina e aspecto elegante no dia a dia.",
  service4Title: "Manutencao",
  service4Text: "Ajuste da estrutura, correcao do crescimento e renovacao do acabamento.",
  splitEyebrow: "Como funciona",
  splitTitle: "Do preparo a finalizacao, cada etapa protege o resultado",
  splitText: "O procedimento comeca com avaliacao das unhas, higienizacao, preparo da superficie, escolha do formato, aplicacao do produto adequado e finalizacao com cor, brilho ou decoracao.",
  splitImage: "assets/site/split-placeholder.svg",
  portfolioEyebrow: "Portfolio",
  portfolioTitle: "Acabamentos para inspirar sua proxima escolha",
  feedTitle: "Acompanhe as novidades",
  careEyebrow: "Dicas e cuidados",
  careTitle: "Pequenos cuidados mantem suas unhas lindas por mais tempo",
  care1Title: "Use luvas ao lidar com produtos de limpeza",
  care1Text: "Quimicos fortes podem reduzir o brilho e comprometer a durabilidade do acabamento.",
  care2Title: "Evite usar as unhas como ferramenta",
  care2Text: "Abrir embalagens ou raspar superficies pode causar trincas e deslocamentos.",
  care3Title: "Hidrate cuticulas diariamente",
  care3Text: "Oleos e hidratantes ajudam a manter a pele ao redor das unhas com aspecto saudavel.",
  care4Title: "Respeite o prazo de manutencao",
  care4Text: "O retorno no periodo indicado preserva a estrutura e deixa o resultado sempre alinhado.",
  portfolioPhotos: [
    { url: "assets/site/portfolio-placeholder.svg", caption: "Delicado e natural" },
    { url: "assets/site/portfolio-placeholder.svg", caption: "Cor e brilho" },
    { url: "assets/site/portfolio-placeholder.svg", caption: "Classico elegante" },
  ],
  feedPosts: [],
};

const LANDING_TEXT_FIELDS = [
  "heroEyebrow", "heroTitle", "heroDescription", "heroImage",
  "highlight1Title", "highlight1Text", "highlight2Title", "highlight2Text", "highlight3Title", "highlight3Text",
  "servicesEyebrow", "servicesTitle",
  "service1Title", "service1Text", "service2Title", "service2Text", "service3Title", "service3Text", "service4Title", "service4Text",
  "splitEyebrow", "splitTitle", "splitText", "splitImage",
  "portfolioEyebrow", "portfolioTitle", "feedTitle",
  "careEyebrow", "careTitle",
  "care1Title", "care1Text", "care2Title", "care2Text", "care3Title", "care3Text", "care4Title", "care4Text",
];

function getLandingContent() {
  return { ...DEFAULT_LANDING_CONTENT, ...(state.landingContent || {}) };
}

function updateImageUploadPreview(fieldId, src) {
  const preview = document.querySelector(`#${fieldId}Preview`);
  if (!preview) return;
  if (src) {
    preview.src = src;
    preview.style.display = "block";
  } else {
    preview.removeAttribute("src");
    preview.style.display = "none";
  }
}

function imageFileToDataUrl(file, maxSize = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Selecione um arquivo de imagem."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.onerror = () => reject(new Error("Nao foi possivel ler esta imagem."));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Nao foi possivel carregar o arquivo."));
    reader.readAsDataURL(file);
  });
}

function bindLandingImageUpload(fieldId) {
  const fileInput = document.querySelector(`#${fieldId}File`);
  let valueInput = document.querySelector(`#${fieldId}`);
  
  if (!valueInput) return;

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        toast("Enviando imagem para o Storage...");
        const downloadUrl = await uploadLandingImageFile(file, `landing/${fieldId}`);
        valueInput.value = downloadUrl;
        updateImageUploadPreview(fieldId, downloadUrl);
        toast("Imagem salva no Storage. Clique em Salvar site para publicar.");
      } catch (err) {
        console.error("Erro ao enviar imagem:", err);
        toast(err.message || "Nao foi possivel enviar a imagem.");
        fileInput.value = "";
      }
    });
  }

  // Allow pasting/typing a direct image URL and update preview immediately
  valueInput.addEventListener("input", () => {
    try {
      const url = (valueInput.value || "").trim();
      updateImageUploadPreview(fieldId, url);
    } catch (err) {
      console.error("Erro ao atualizar pré-visualização:", err);
    }
  });
}

function renderLandingEditor() {
  if (!document.querySelector("#landingEditorPanel")) return;
  const content = getLandingContent();

  // Preencher os campos de texto, incluindo textareas
  LANDING_TEXT_FIELDS.forEach((key) => {
    const el = document.querySelector(`#lc_${key}`);
    if (el && el.type !== "hidden") {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        el.value = content[key] || "";
      }
    }
  });
  
  // Preencher as imagens
  updateImageUploadPreview("lc_heroImage", content.heroImage || "");
  // ensure URL input exists and is filled (support variants with/without lc_ prefix)
  const heroInput = document.querySelector('#lc_heroImage') || document.querySelector('#heroImage');
  if (heroInput && heroInput.tagName === 'INPUT') heroInput.value = content.heroImage || '';
  updateImageUploadPreview("lc_splitImage", content.splitImage || "");
  const splitInput = document.querySelector('#lc_splitImage') || document.querySelector('#splitImage');
  if (splitInput && splitInput.tagName === 'INPUT') splitInput.value = content.splitImage || '';
  renderPortfolioPhotosEditor(content.portfolioPhotos || []);
  // feed removed from admin editor
}

function renderPortfolioPhotosEditor(photos) {
  const container = document.querySelector("#portfolioPhotosEditor");
  if (!container) return;

  if (!photos || !photos.length) {
    container.innerHTML = `<div class="muted" style="padding:12px">Nenhuma foto. Clique em "+ Adicionar foto".</div>`;
    return;
  }

  container.innerHTML = photos.map((photo, i) => `
    <div class="photo-editor-row" data-photo-index="${i}">
      <div class="photo-upload-cell">
        ${photo.url
          ? `<img class="photo-preview-thumb" src="${escapeHtml(photo.url)}" alt="foto ${i + 1}" />`
          : `<div class="photo-preview-empty">Sem foto</div>`
        }
        <div class="photo-upload-actions">
          ${photo.url ? `<button class="remove-photo-btn" data-remove-photo="${i}" type="button" title="Remover foto">🗑 Remover</button>` : ""}
        </div>
      </div>
      <div style="display:grid;gap:8px">
        <label>
          Link da foto
          <input class="photo-url-input" value="${escapeHtml(photo.url || "")}" placeholder="https://... (URL da imagem)" data-index="${i}" />
        </label>
        <label>
          Legenda
          <input class="photo-caption-input" value="${escapeHtml(photo.caption || "")}" placeholder="Ex.: Alongamento nude" />
        </label>
      </div>
    </div>
  `).join("");

  // Bind alteração de URL para cada foto para atualizar preview
  container.querySelectorAll(".photo-url-input").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.index);
      const url = input.value.trim();
      const preview = container.querySelector(`.photo-editor-row[data-photo-index="${index}"] .photo-upload-cell`);
      if (preview) {
        if (url) {
          preview.innerHTML = `<img class="photo-preview-thumb" src="${escapeHtml(url)}" alt="foto ${index + 1}" /><div class="photo-upload-actions"><button class="remove-photo-btn" data-remove-photo="${index}" type="button" title="Remover foto">🗑 Remover</button></div>`;
          // Re-bind remove button since we replaced innerHTML
          preview.querySelector("[data-remove-photo]").addEventListener("click", () => {
            const content = readLandingEditorValues();
            const updatedPhotos = [...(content.portfolioPhotos || [])];
            updatedPhotos.splice(index, 1);
            state.landingContent = { ...content, portfolioPhotos: updatedPhotos };
            renderPortfolioPhotosEditor(updatedPhotos);
          });
        } else {
          preview.innerHTML = `<div class="photo-preview-empty">Sem foto</div><div class="photo-upload-actions"></div>`;
        }
      }
    });
  });

  // Bind remoção
  container.querySelectorAll("[data-remove-photo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const content = readLandingEditorValues();
      const updatedPhotos = [...(content.portfolioPhotos || [])];
      updatedPhotos.splice(Number(btn.dataset.removePhoto), 1);
      state.landingContent = { ...content, portfolioPhotos: updatedPhotos };
      renderPortfolioPhotosEditor(updatedPhotos);
    });
  });
}

function renderFeedPostsEditor() { /* feed removed */ }

function readLandingEditorValues() {
  const content = getLandingContent();

  LANDING_TEXT_FIELDS.forEach((key) => {
    const el = document.querySelector(`#lc_${key}`);
    if (el) content[key] = el.value.trim();
  });

  const photoRows = document.querySelectorAll(".photo-editor-row");
  if (photoRows.length || document.querySelector("#portfolioPhotosEditor")) {
    content.portfolioPhotos = Array.from(photoRows).map((row) => ({
      url: (row.querySelector(".photo-url-input")?.value || "").trim(),
      caption: (row.querySelector(".photo-caption-input")?.value || "").trim(),
    })).filter((p) => p.url);
  }

  // feed removed — do not collect feedPosts from editor

  return content;
}

function buildStateWithLanding(newLanding) {
  const base = serializableState();
  base.landingContent = newLanding || {};
  return base;
}

async function saveLandingContent() {
  const newLanding = readLandingEditorValues();

  if (!isFirebaseConfigured()) {
    toast("Firebase não está configurado. Configure o Firebase para salvar no servidor.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);

  if (!firebase.auth().currentUser) {
    toast("Faça login como administrador para salvar alterações no Firebase.");
    return;
  }

  try {
    toast("Salvando no Firebase...");
    if (!remoteDb) remoteDb = firebase.firestore();
    if (!remoteDocRef) remoteDocRef = remoteDb.doc(window.FIREBASE_DOC_PATH || "sistemas/firebase");

    await remoteDocRef.set({ state: buildStateWithLanding(newLanding), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // Only update local state after successful remote save
    state.landingContent = newLanding;
    renderLandingEditor();
    toast("Site salvo no Firebase com sucesso.");
  } catch (err) {
    console.error("Erro ao salvar landingContent no Firebase:", err);
    toast("Não foi possível salvar no Firebase. Verifique permissões ou conexão.");
  }
}

function bindLandingEditor() {
  document.querySelector("#saveLandingContent")?.addEventListener("click", saveLandingContent);
  bindLandingImageUpload("lc_heroImage");
  bindLandingImageUpload("lc_splitImage");

  document.querySelector("#addPortfolioPhoto")?.addEventListener("click", () => {
    const content = readLandingEditorValues();
    const photos = [...(content.portfolioPhotos || []), { url: "", caption: "" }];
    state.landingContent = { ...content, portfolioPhotos: photos };
    renderPortfolioPhotosEditor(photos);
  });
  // feed removed — no add feed post button
}

bindNavigation();
bindModalClose();
bindForms();
bindButtons();
bindInputs();
bindLandingEditor();
renderAll();
initAuth();
