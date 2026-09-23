/**
 * app.js — TalkWithMe frontend orchestrator.
 *
 * This file is intentionally slim. It coordinates initialization across
 * feature modules (state, chat, tts, stt, persona, chatrooms, settings, theme).
 *
 * Cross-cutting concerns that multiple modules depend on live here:
 *  - loadPersonas() — fetched by persona.js after CRUD, triggers loadChatRooms()
 *  - Health checks — called by init() and settings.js after save
 *  - Event listener setup — wires up topbar buttons shared across modules
 */

/* ==========================================================================
   Initialization
   ========================================================================== */

async function init() {
    initTheme();
    applyMobileDefaults();
    await loadPersonas(); // Also loads chat rooms internally
    await checkTTSHealth();
    await checkSTTHealth();
    await loadGeneralSettings();
    setupEventListeners();
    setupChatRoomEventListeners();

    // Load persisted history for the current room
    const history = await loadPersistedHistory(currentChatRoom);
    renderPersistedHistory(history.messages, currentChatRoom);
}

/**
 * On a phone-sized screen the "Who should answer?" chooser is hidden and the
 * persona strip is the only responder control, so default to "Selected
 * persona": tapping an avatar is then all it takes to pick who answers.
 */
function applyMobileDefaults() {
    if (!isMobileLayout()) return;
    const selectedRadio = document.querySelector('input[name="who_answers"][value="selected"]');
    if (selectedRadio) selectedRadio.checked = true;
}

/**
 * Fetch general settings from the server. Currently only used to gate
 * the persona-name-mention detection feature.
 */
async function loadGeneralSettings() {
    try {
        const resp = await fetch("/api/settings");
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.general != null) {
            personaNameMentionsEnabled = data.general.persona_name_mentions;
            maxPersonaReplies = data.general.max_persona_replies ?? 1;
            maxTurnsForContext = data.general.max_turns_for_context ?? 6;
        }
    } catch (err) {
        console.warn("Failed to load general settings, using defaults:", err);
    }
}

/**
 * Load personas from server, then refresh chat rooms so persona lists
 * in each room are up to date (handles rename/delete cascades).
 * Called by init() on startup and by persona.js after CRUD operations.
 */
async function loadPersonas() {
    try {
        const resp = await fetch("/api/personas");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        // Keep the shared global sorted: consumers like applyChatRoomFilter()
        // auto-select `filtered[0]`, which should match the first rendered
        // (alphabetical) card in the sidebar.
        const list = await resp.json();
        personas = list.sort(comparePersonasByName);
        await loadChatRooms();
    } catch (err) {
        console.error("Failed to load personas:", err);
    }
}

/* ==========================================================================
   Health checks
   ========================================================================== */

async function checkTTSHealth() {
    try {
        const resp = await fetch("/api/tts/health");
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        ttsAvailable = data.available;
        ttsStreaming = data.streaming || false;
        ttsEnabled = data.available; // Default on if server is available
        ttsServerType = data.server_type || "";
        updateTTSToggleUI();
    } catch (err) {
        console.warn("TTS health check failed:", err);
        ttsAvailable = false;
        ttsStreaming = false;
        ttsEnabled = false;
        ttsServerType = "";
        updateTTSToggleUI();
    }
}

async function checkSTTHealth() {
    try {
        const resp = await fetch("/api/stt/health");
        const data = await resp.json();
        sttAvailable = data.available;
        updateMicButtonUI();
    } catch (err) {
        console.warn("STT health check failed:", err);
        sttAvailable = false;
        updateMicButtonUI();
    }
}

/* ==========================================================================
   Top-level event listeners (shared UI controls)
   ========================================================================== */

function setupEventListeners() {
    sendBtn.addEventListener("click", () => {
        unlockAudio();
        sendMessage();
    });
    inputEl.addEventListener("keydown", (e) => {
        // Enter sends; Shift+Enter for newline
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            unlockAudio();
            sendMessage();
        }
    });

    // Auto-resize textarea
    inputEl.addEventListener("input", () => {
        inputEl.style.height = "auto";
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
    });

    newChatBtn.addEventListener("click", newChat);
    ttsToggleBtn.addEventListener("click", () => {
        unlockAudio();
        toggleTTS();
    });
    micBtn.addEventListener("click", () => {
        unlockAudio();
        toggleMicrophone();
    });
    setupTopbarMenu();
    themeSelectEl.addEventListener("change", () => {
        applyTheme(themeSelectEl.value, true);
    });

    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.code === "Space" && !micBtn.disabled) {
            e.preventDefault();
            unlockAudio();
            toggleMicrophone();
        }
    });
}

/**
 * Mobile topbar menu: the admin buttons live in #topbar-menu, which the
 * mobile stylesheet shows only while #topbar has the "menu-open" class.
 * On desktop the menu button is hidden and the class has no effect.
 */
function setupTopbarMenu() {
    const topbar = document.getElementById("topbar");
    const menuBtn = document.getElementById("btn-menu");
    const menu = document.getElementById("topbar-menu");

    const setOpen = (open) => {
        topbar.classList.toggle("menu-open", open);
        menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };

    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        setOpen(!topbar.classList.contains("menu-open"));
    });
    // Picking an action (each opens a modal or resets the chat) closes the
    // menu; the theme <select> keeps it open so themes can be previewed.
    menu.addEventListener("click", (e) => {
        if (e.target.closest("button")) setOpen(false);
    });
    document.addEventListener("click", (e) => {
        if (!topbar.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setOpen(false);
    });
}

/* ==========================================================================
   Session management
   ========================================================================== */

async function newChat() {
    try {
        // POST /api/session/new clears both the in-memory session AND
        // the persisted files for the current room.
        await fetch("/api/session/new", { method: "POST" });
        messagesEl.innerHTML = "";
        showEmptyState();
    } catch (err) {
        console.error("Failed to reset session:", err);
    }
}

/* ==========================================================================
   Boot
   ========================================================================== */

init();
