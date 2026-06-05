// landing.js — carrega conteúdo editável do Firebase e renderiza feed

const LANDING_DOC_PATH = "sistemas/firebase";

const DEFAULT_LANDING = {
  heroEyebrow: "Nail design, alongamento e cuidado",
  heroTitle: "Rayssa Oliveira Nail Design",
  heroDescription: "Unhas feitas com acabamento delicado, planejamento do formato e orientacao de cuidados para manter o resultado bonito por mais tempo.",
  heroImage: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1300&q=85",
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
  splitImage: "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=900&q=85",
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
    { url: "https://images.unsplash.com/photo-1599206676335-193c82b13c9e?auto=format&fit=crop&w=700&q=85", caption: "Delicado e natural" },
    { url: "https://images.unsplash.com/photo-1610992015732-2449b76344bc?auto=format&fit=crop&w=700&q=85", caption: "Cor e brilho" },
    { url: "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=700&q=85", caption: "Classico elegante" },
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
  applyLandingContent(DEFAULT_LANDING);
  renderPortfolio(DEFAULT_LANDING.portfolioPhotos);
  renderFeed(DEFAULT_LANDING.feedPosts);

  if (!isFirebaseConfigured() || window.location.protocol === "file:") return;

  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.firestore();
  docRef = db.doc(LANDING_DOC_PATH);

  // Escutar mudanças em tempo real
  docRef.onSnapshot((snapshot) => {
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    const remoteState = data.state || {};
    // Mesclar settings (nome, logo, cores) com landingContent
    const settings = remoteState.settings || {};
    const content = {
      ...DEFAULT_LANDING,
      ...(remoteState.landingContent || {}),
      // Propagar campos de settings para o site
      companyName: settings.companyName || DEFAULT_LANDING.heroTitle,
      subtitle: settings.subtitle || "Nail Design",
      logoText: settings.logoText || "",
      logoImage: settings.logoImage || "",
      colors: settings.colors || null,
    };
    landingContent = content;
    applyLandingContent(content);
    renderPortfolio(content.portfolioPhotos || DEFAULT_LANDING.portfolioPhotos);
    renderFeed(content.feedPosts || []);
    // Se o dialog de post estiver aberto, atualizar comentários em tempo real
    if (activeFeedPostId) {
      const post = (content.feedPosts || []).find((p) => p.id === activeFeedPostId);
      if (post) renderFeedComments(post.comments || []);
    }
  }, (err) => console.error("Landing sync error:", err));

  // Verificar se cliente está logado para permitir comentários
  firebase.auth().onAuthStateChanged((user) => {
    currentClientUser = user;
    currentClientIsAdmin = false;
    if (user) {
      // Buscar dados do cliente e verificar se é admin
      Promise.all([
        docRef.get(),
        db.collection("users").doc(user.uid).get(),
      ]).then(([stateSnap, userSnap]) => {
        const remoteState = stateSnap.data()?.state || {};
        const clientes = Array.isArray(remoteState.clientes) ? remoteState.clientes : [];
        currentClientData = clientes.find((c) => c.authUid === user.uid) ||
          clientes.find((c) => c.email && user.email && c.email.toLowerCase() === user.email.toLowerCase()) || null;
        // Admin = tem documento na coleção users com permissions.admin = true
        if (userSnap.exists) {
          const perms = userSnap.data()?.permissions || {};
          currentClientIsAdmin = Boolean(perms.admin);
        }
        updateFeedCommentUI();
      }).catch((err) => console.error("Landing auth error:", err));
    } else {
      currentClientData = null;
      updateFeedCommentUI();
    }
  });

  // Fechar dialog
  document.querySelector("#closeFeedDialog")?.addEventListener("click", () => {
    document.querySelector("#feedPostDialog").close();
    activeFeedPostId = null;
  });

  // Enviar comentário
  document.querySelector("#feedCommentSubmit")?.addEventListener("click", submitFeedComment);
  document.querySelector("#feedCommentInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitFeedComment(); }
  });
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
  set("feedTitle", content.feedTitle);
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
  const grid = document.getElementById("feedGrid");
  if (!grid) return;
  if (!posts || !posts.length) {
    grid.innerHTML = `<div class="feed-empty">Nenhuma publicação ainda.</div>`;
    return;
  }
  grid.innerHTML = posts.map((post) => {
    const commentCount = (post.comments || []).length;
    return `
      <article class="feed-card" data-post-id="${escapeHtml(post.id)}">
        <div class="feed-card-media">
          <img src="${escapeHtml(post.imageUrl || '')}" alt="${escapeHtml(post.caption || '')}" loading="lazy" />
          <div class="feed-card-overlay">
            <span>💬 ${commentCount}</span>
          </div>
        </div>
        <div class="feed-card-body">
          <p class="feed-card-caption">${escapeHtml(post.caption || "")}</p>
          <span class="feed-card-date">${formatDate(post.createdAt)}</span>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll(".feed-card").forEach((card) => {
    card.addEventListener("click", () => openFeedPost(card.dataset.postId));
  });
}

function openFeedPost(postId) {
  const posts = landingContent.feedPosts || [];
  const post = posts.find((p) => p.id === postId);
  if (!post) return;
  activeFeedPostId = postId;

  document.getElementById("feedPostImage").src = post.imageUrl || "";
  document.getElementById("feedPostCaption").textContent = post.caption || "";
  renderFeedComments(post.comments || []);
  updateFeedCommentUI();
  document.getElementById("feedPostDialog").showModal();
}

function renderFeedComments(comments) {
  const list = document.getElementById("feedCommentsList");
  if (!list) return;
  if (!comments.length) {
    list.innerHTML = `<div class="feed-no-comments">Seja o primeiro a comentar!</div>`;
    return;
  }
  list.innerHTML = comments.map((c, i) => `
    <div class="feed-comment" data-comment-index="${i}">
      <div class="feed-comment-header">
        <strong>${escapeHtml(c.authorName || "Cliente")}</strong>
        <small>${formatDate(c.createdAt)}</small>
        ${isAdminUser() ? `<button class="feed-delete-comment" data-comment-index="${i}" title="Excluir comentário" type="button">🗑</button>` : ""}
      </div>
      <span>${escapeHtml(c.text)}</span>
    </div>
  `).join("");
  list.scrollTop = list.scrollHeight;

  list.querySelectorAll(".feed-delete-comment").forEach((btn) => {
    btn.addEventListener("click", () => deleteComment(Number(btn.dataset.commentIndex)));
  });
}

function isAdminUser() {
  return currentClientIsAdmin === true;
}

async function deleteComment(commentIndex) {
  if (!activeFeedPostId || !db) return;
  if (!confirm("Excluir este comentário?")) return;
  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      const data = snapshot.data() || {};
      const state = data.state || {};
      const content = { ...DEFAULT_LANDING, ...(state.landingContent || {}) };
      const posts = Array.isArray(content.feedPosts) ? content.feedPosts : [];
      const postIndex = posts.findIndex((p) => p.id === activeFeedPostId);
      if (postIndex === -1) return;
      const comments = [...(posts[postIndex].comments || [])];
      comments.splice(commentIndex, 1);
      posts[postIndex].comments = comments;
      content.feedPosts = posts;
      transaction.set(docRef, {
        state: { ...state, landingContent: content },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // Atualizar localmente
      landingContent = content;
      renderFeedComments(comments);
    });
  } catch (err) {
    console.error("Erro ao excluir comentário:", err);
    alert("Não foi possível excluir o comentário.");
  }
}

function updateFeedCommentUI() {
  const form = document.getElementById("feedCommentForm");
  const loginMsg = document.getElementById("feedCommentLogin");
  if (!form || !loginMsg) return;
  if (currentClientUser && currentClientData) {
    form.style.display = "flex";
    loginMsg.style.display = "none";
  } else {
    form.style.display = "none";
    loginMsg.style.display = "block";
  }
  // Re-renderizar comentários para mostrar/esconder botão de excluir do admin
  if (activeFeedPostId) {
    const posts = landingContent.feedPosts || [];
    const post = posts.find((p) => p.id === activeFeedPostId);
    if (post) renderFeedComments(post.comments || []);
  }
}

async function submitFeedComment() {
  if (!currentClientUser || !currentClientData || !activeFeedPostId || !db) return;
  const input = document.getElementById("feedCommentInput");
  const text = input.value.trim();
  if (!text) return;

  const comment = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    authorName: currentClientData.nome || currentClientUser.displayName || "Cliente",
    authorUid: currentClientUser.uid,
    text,
    createdAt: new Date().toISOString(),
  };

  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      const data = snapshot.data() || {};
      const state = data.state || {};
      const content = { ...DEFAULT_LANDING, ...(state.landingContent || {}) };
      const posts = Array.isArray(content.feedPosts) ? content.feedPosts : [];
      const postIndex = posts.findIndex((p) => p.id === activeFeedPostId);
      if (postIndex === -1) throw new Error("Post não encontrado.");
      posts[postIndex].comments = [...(posts[postIndex].comments || []), comment];
      content.feedPosts = posts;
      transaction.set(docRef, {
        state: { ...state, landingContent: content },
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    input.value = "";
  } catch (err) {
    console.error("Erro ao comentar:", err);
    alert("Não foi possível enviar o comentário.");
  }
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
