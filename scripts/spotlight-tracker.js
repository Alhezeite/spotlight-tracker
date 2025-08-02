let spotlightPanel;
let lastRolledActorId = null;


Hooks.once("init", () => {
  // Настройки
  game.settings.register("spotlight-tracker", "defaultTokens", {
    name: "Максимум действий",
    hint: "Сколько действий может совершить каждый игрок за раунд",
    scope: "world",
    config: true,
    type: Number,
    default: 3
  });

  game.settings.register("spotlight-tracker", "enableTracker", {
    name: "Включить Spotlight Tracker",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("spotlight-tracker", "warningMessage", {
    name: "Сообщение при исчерпании действий",
    hint: "Сообщение, которое увидит игрок, если он использовал все доступные действия",
    scope: "world",
    config: true,
    type: String,
    default: "❌ Ты пока что не в свете софитов. Не растраивайся."
  });

  // Подключаем jQuery UI (только если его нет)
  if (typeof $.ui === "undefined") {
    const script = document.createElement("script");
    script.src = "https://code.jquery.com/ui/1.13.2/jquery-ui.min.js";
    script.onload = () => console.log("✅ jQuery UI загружен");
    document.head.appendChild(script);
  }
});
   


Hooks.on("ready", async () => {
  if (game.settings.get("spotlight-tracker", "enableTracker")) {
    createSpotlightPanel();
  }

  await initializeTracker();
  await updateSpotlightPanel();
});


Hooks.on("diceSoNiceRollStart", async (messageId) => {
  //if (!game.settings.get("spotlight-tracker", "enableTracker")) return;  
  const message = game.messages.get(messageId);
  //тут проверка на дуальность и проиче броски
  const flags = message.flags?.daggerheart;
  //console.log("🎲 Ролл завершён:", message);
  //console.log("🎯 Флаги:", message.flags?.daggerheart);
  if (
	  flags?.reaction === true ||
	  flags?.isManualRoll === true ||
	  ["npc", "damage"].includes(flags?.rollType)
	) return;

  //console.log("✅ Дуальность (chatMessage) подтверждена!", message);
	
  const actorId = flags.actorId ?? message.speaker?.actor;
  const actor = game.actors.get(actorId);
  if (!actor) return;
  lastRolledActorId = actorId;
  const user = game.users.find(u => u.active && !u.isGM && u.character?.id === actor.id);
  if (!user) return;

  const used = await actor.getFlag("spotlight-tracker", "actionsUsed") ?? 0;
  const max = game.settings.get("spotlight-tracker", "defaultTokens");

  if (used >= max) {
    game.socket.emit("module.spotlight-tracker", {
	  type: "notifyUsedUp",
	  userId: user.id
	});
    throw new Error("Блокировка: максимум действий достигнут");
  }
  
  await actor.setFlag("spotlight-tracker", "actionsUsed", used + 1);
  await updateSpotlightPanel();
  await checkAndResetIfNeeded();
  ui.combat.render(); // перерисовать инициативу
});

async function checkAndResetIfNeeded() {
  const users = getActiveUsers();
  const allDone = await Promise.all(users.map(async user => {
    const actor = user.character;
    const used = await actor.getFlag("spotlight-tracker", "actionsUsed") ?? 0;
    const max = game.settings.get("spotlight-tracker", "defaultTokens");
    return used >= max;
  }));
  if (allDone.every(Boolean)) {
    for (const user of users) {
      await user.character.setFlag("spotlight-tracker", "actionsUsed", 0);
    }
    ui.notifications.info("🔄 Все действия потрачены. Раунд сброшен.");
    await updateSpotlightPanel();
  }
}

async function initializeTracker() {
  const users = getActiveUsers();
  for (const user of users) {
    await user.character.setFlag("spotlight-tracker", "actionsUsed", 0);
  }
}

function getActiveUsers() {
  return game.users.filter(u => u.active && !u.isGM && u.character);
}

function createSpotlightPanel() {
  console.log("🟢 Spotlight панель создаётся");

  const html = $(`
  <div id="spotlight-panel" style="
    position: absolute;
    top: 60px;             /* ← Вместо bottom */
    left: 100px;
    width: 240px;
    min-height: 80px;
    background: rgba(0,0,0,0.2);
    padding: 10px;
    border: 1px solid #999;
    border-radius: 5px;
    z-index: 100;
    transition: background 0.3s ease, box-shadow 0.3s ease;
  ">
    <h3 style="margin: 0 0 5px 0; color: white; cursor: move;">🎯 Spotlight</h3>
    <ul class="players" style="list-style: none; margin: 0; padding: 0;"></ul>
    ${game.user.isGM ? `<button id="reset-spotlight" style="margin-top: 10px;">🔁 Сбросить действия</button>` : ""}
  </div>
`);


  // Добавим эффект при наведении
  const hoverStyle = `
    <style id="spotlight-hover-style">
      #spotlight-panel:hover {
        background: rgba(0, 0, 0, 0.85);
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
      }
    </style>
  `;
  if (!document.getElementById("spotlight-hover-style")) {
    $("head").append(hoverStyle);
  }

  $("body").append(html);

  // Активируем перетаскивание (если доступно)
  setTimeout(() => {
    if ($.ui?.draggable) {
      html.draggable({
        handle: "h3",
        containment: "window"
      });
    } else {
      console.warn("⚠️ jQuery UI draggable не доступен");
    }
  }, 100);
  if (game.user.isGM) {
  html.find("#reset-spotlight").on("click", async () => {
    for (const user of getActiveUsers()) {
      await user.character.setFlag("spotlight-tracker", "actionsUsed", 0);
    }
    await updateSpotlightPanel();
    ui.combat.render(); // ← добавь перерисовку, если нужно сразу увидеть результат
  });
}


  spotlightPanel = html;
  updateSpotlightPanel();
}



async function updateSpotlightPanel() {
  if (!spotlightPanel) return;

  const list = spotlightPanel.find(".players");
  list.empty();

  const users = getActiveUsers();
  for (const user of users) {
    const actor = user.character;
    const used = await actor.getFlag("spotlight-tracker", "actionsUsed") ?? 0;
    const max = game.settings.get("spotlight-tracker", "defaultTokens");

    const item = $(`
      <li style="color: white; margin-bottom: 3px;">
        <strong>${actor.name}</strong>: ${used} / ${max}
      </li>
    `);
    list.append(item);
  }
}

Hooks.on("renderSceneControls", () => {
  if (!game.user.isGM) return;
  if ($("#toggle-spotlight").length > 0) return;

  const button = $(`
    <li class="control-tool" id="toggle-spotlight" title="Spotlight Трекер">
      <i class="fas fa-lightbulb"></i>
    </li>
  `);

  button.on("click", () => {
    if ($("#spotlight-panel").length) {
      $("#spotlight-panel").remove();
      spotlightPanel = null;
    } else {
      createSpotlightPanel();
    }
  });

  $(".scene-control .control-tools").first().append(button);
});

Hooks.once("ready", () => {  
  if (!game.settings.get("spotlight-tracker", "enableTracker")) return;  	
  game.socket.on("module.spotlight-tracker", async (data) => {
    if (data.type === "notifyUsedUp" && game.user.id === data.userId) {
      const msg = game.settings.get("spotlight-tracker", "warningMessage") || "❌ Ты пока что не в свете софитов. Не растраивайся.";
      ui.notifications.warn(msg, { permanent: true });
    }
  });
});


Hooks.once("socketlib.ready", () => {
  game.socket.on("module.spotlight-tracker", async (data) => {
    if (data.type === "notifyUsedUp" && game.user.id === data.userId) {
      game.socket.emit("module.spotlight-tracker", {
	  type: "notifyUsedUp",
	  userId: user.id
	});
    }
  });
});


Hooks.on("renderCombatTracker", async (app, htmlElement, data) => {	
  //if (!lastRolledActorId) return;
  const html = $(htmlElement); // 👈 Оборачиваем
  const combatants = game.combat?.combatants ?? [];
  for (const combatant of combatants) {
    const actor = game.actors.get(combatant.actorId);
    if (!actor) continue;

    const used = await actor.getFlag("spotlight-tracker", "actionsUsed") ?? 0;
    const max = await actor.getFlag("spotlight-tracker", "actionsMax") ?? game.settings.get("spotlight-tracker", "defaultTokens");

    const li = html.find(`.combatant[data-combatant-id="${combatant.id}"]`);
    const control = li.find(".token-initiative");

    if (control.length) {
      control.html(`<span style="color: #ffcc00; font-weight: bold;">${max - used}</span>`);
    }
  }
  
});



Hooks.on("combatRound", async (combat, round) => {
  const max = game.settings.get("spotlight-tracker", "defaultTokens");

  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (actor && actor.hasPlayerOwner) {
      await actor.setFlag("spotlight-tracker", "actionsUsed", 0);
      await actor.setFlag("spotlight-tracker", "actionsMax", max);
    }
  }

  ui.combat.render(); // чтобы сразу обновилось
});
