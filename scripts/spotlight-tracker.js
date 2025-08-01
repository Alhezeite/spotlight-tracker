let spotlightPanel;

Hooks.once("init", () => {
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

});

Hooks.on("ready", async () => {
  if (!game.settings.get("spotlight-tracker", "enableTracker")) return;

  if (game.user.isGM) createSpotlightPanel();

  await initializeTracker();
  await updateSpotlightPanel();
});

Hooks.on("diceSoNiceRollStart", async (messageId) => {
  if (!game.settings.get("spotlight-tracker", "enableTracker")) return;  
  const message = game.messages.get(messageId);
  
  const flags = message.flags?.daggerheart.reaction === true;
  if (flags) return;  
  console.log("✅ Дуальность (chatMessage) подтверждена!", message);
	
  const actorId = flags.actorId ?? message.speaker?.actor;
  const actor = game.actors.get(actorId);
  if (!actor) return;

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
    <div id="spotlight-panel" class="spotlight-tracker flexcol" style="position: absolute; top: 100px; left: 100px; background: rgba(0,0,0,0.7); padding: 10px; border: 1px solid #999; border-radius: 5px; z-index: 100;">
      <h3 style="margin: 0 0 5px 0; color: white;">🎯 Spotlight</h3>
      <ul class="players" style="list-style: none; margin: 0; padding: 0;"></ul>
      <button id="reset-spotlight" style="margin-top: 10px;">🔁 Сбросить действия</button>
    </div>
  `);
  //html.draggable({ handle: "h3" });
  html.find("#reset-spotlight").on("click", async () => {
    for (const user of getActiveUsers()) {
      await user.character.setFlag("spotlight-tracker", "actionsUsed", 0);
    }
    await updateSpotlightPanel();
  });


  $("body").append(html);
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
