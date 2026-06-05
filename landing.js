// landing.js — carrega conteúdo editável do Firebase e renderiza feed

const LANDING_DOC_PATH = "sistemas/firebase";

const DEFAULT_LANDING = {
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

let db = null;
let docRef = null;
let landingContent = { ...DEFAULT_LANDING };
let currentClientUser = null;
let currentClientData = null;
let currentClientIsAdmin = false;
let activeFeedPostId = null;

function isFirebaseConfigured() {
  const config = window.FIREBASE_CONFIG;
  return Boolean(window.firebase && config && config.apiKey && config.projectId &&
    !String(config.apiKey).startsWith("YOUR_API_KEY") && !String(config.projectId).startsWith("YOUR_PROJECT_ID"));
}

function initLanding() {
  // Mostrar conteúdo padrão inicialmente
  applyLandingContent(DEFAULT_LANDING);
  renderPortfolio(DEFAULT_LANDING.portfolioPhotos);
  // feed removido — não renderizar

  if (!isFirebaseConfigured() || window.location.protocol === "file:") return;

  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.firestore();
  docRef = db.doc(LANDING_DOC_PATH);

  const applyRemoteSnapshot = (snapshot) => {
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    const remoteState = data.state || data;

    // Mesclar settings (nome, logo, cores) com landingContent
    const settings = remoteState.settings || {};
    const remoteContent = remoteState.landingContent || data.landingContent || {};
    const content = {
      ...DEFAULT_LANDING,
      ...remoteContent,
      // Propagar campos de settings para o site
      companyName: settings.companyName || DEFAULT_LANDING.heroTitle,
      subtitle: settings.subtitle || "Nail Design",
      logoText: settings.logoText || "",
      logoImage: settings.logoImage || "",
      colors: settings.colors || null,
      // Garantir que imagens remotas sejam preservadas corretamente
      heroImage: remoteContent.heroImage !== undefined ? remoteContent.heroImage : DEFAULT_LANDING.heroImage,
      splitImage: remoteContent.splitImage !== undefined ? remoteContent.splitImage : DEFAULT_LANDING.splitImage,
    };
    landingContent = content;
    applyLandingContent(content);
    renderPortfolio(content.portfolioPhotos || DEFAULT_LANDING.portfolioPhotos);
  };

  // Escutar mudanças em tempo real
  docRef.onSnapshot(applyRemoteSnapshot, (err) => console.error("Landing sync error:", err));

  // Carregar uma vez imediatamente, caso o onSnapshot demore ou a atualização seja gerada antes da conexão
  docRef.get()
    .then(applyRemoteSnapshot)
    .catch((err) => console.error("Landing fetch error:", err));

  // feed/comment UI removed — nothing to initialize
}

function applyLandingContent(content) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el && value !== undefined) el.textContent = value;
  };
  const setImg = (id, src) => {
    const el = document.getElementById(id);
    if (el && src) el.src = src;
  };

  set("landingBrandName", content.companyName || "Rayssa Oliveira");
  set("landingBrandSubtitle", content.subtitle || "Nail Design");
  set("heroEyebrow", content.heroEyebrow);
  set("heroTitle", content.heroTitle);
  set("heroDescription", content.heroDescription);
  setImg("heroImage", content.heroImage);
  set("highlight1Title", content.highlight1Title);
  set("highlight1Text", content.highlight1Text);
  set("highlight2Title", content.highlight2Title);
  set("highlight2Text", content.highlight2Text);
  set("highlight3Title", content.highlight3Title);
  set("highlight3Text", content.highlight3Text);
  set("servicesEyebrow", content.servicesEyebrow);
  set("servicesTitle", content.servicesTitle);
  set("service1Title", content.service1Title);
  set("service1Text", content.service1Text);
  set("service2Title", content.service2Title);
  set("service2Text", content.service2Text);
  set("service3Title", content.service3Title);
  set("service3Text", content.service3Text);
  set("service4Title", content.service4Title);
  set("service4Text", content.service4Text);
  set("splitEyebrow", content.splitEyebrow);
  set("splitTitle", content.splitTitle);
  set("splitText", content.splitText);
  setImg("splitImage", content.splitImage);
  set("portfolioEyebrow", content.portfolioEyebrow);
  set("portfolioTitle", content.portfolioTitle);
  // feed removed
  set("careEyebrow", content.careEyebrow);
  set("careTitle", content.careTitle);
  set("care1Title", content.care1Title);
  set("care1Text", content.care1Text);
  set("care2Title", content.care2Title);
  set("care2Text", content.care2Text);
  set("care3Title", content.care3Title);
  set("care3Text", content.care3Text);
  set("care4Title", content.care4Title);
  set("care4Text", content.care4Text);
  set("footerName", content.companyName || "Rayssa Oliveira Nail Design");

  // Logo
  const brandMark = document.getElementById("landingBrandMark");
  if (brandMark) {
    if (content.logoImage) {
      brandMark.outerHTML = `<img id="landingBrandMark" class="brand-logo" src="${escapeHtml(content.logoImage)}" alt="${escapeHtml(content.companyName || '')}" />`;
    } else {
      brandMark.textContent = (content.logoText || (content.companyName || "R").slice(0, 1)).toUpperCase();
    }
  }

  // Cor principal
  if (content.colors?.green) document.documentElement.style.setProperty("--sage", content.colors.green);
  if (content.colors?.greenDark) document.documentElement.style.setProperty("--sage-dark", content.colors.greenDark);
  if (content.colors?.beige) document.documentElement.style.setProperty("--cream", content.colors.beige);
  if (content.colors?.ink) document.documentElement.style.setProperty("--ink", content.colors.ink);
}

function renderPortfolio(photos) {
  const grid = document.getElementById("portfolioGrid");
  if (!grid) return;
  if (!photos || !photos.length) {
    grid.innerHTML = "";
    return;
  }
  grid.innerHTML = photos.map((photo, i) => `
    <figure>
      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.caption || '')}" loading="lazy" />
      <figcaption>${escapeHtml(photo.caption || "")}</figcaption>
    </figure>
  `).join("");
}

function renderFeed(posts) {
  // feed removed — hide feed grid if present
  const grid = document.getElementById("feedGrid");
  if (grid) grid.style.display = "none";
}

function openFeedPost(postId) {
  // feed removed
}

function renderFeedComments(comments) {
  // feed comments removed
}

function isAdminUser() {
  return currentClientIsAdmin === true;
}

async function deleteComment(commentIndex) {
  // feed removed
}

function updateFeedCommentUI() {
  // feed UI removed
}

async function submitFeedComment() {
  // feed removed
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

initLanding();
