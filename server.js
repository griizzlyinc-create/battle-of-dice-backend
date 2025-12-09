// server.js
// Backend Battle of Dice V0

const express = require("express");
const cors = require("cors");
const crypto = require("crypto")
const { db } = require("./db");

const app = express();

const PORT = process.env.PORT || 3000; // 👈 IMPORTANT pour Render

app.use(express.json());
app.use(
  cors({
    origin: "*", // pour les tests (on pourra restreindre plus tard)
  })
);

// 🛡️ Wallet admin (en minuscule)
const ADMIN_WALLET = "0xda2c5580b1acf86d4e4526b00cdf1cd691cd84cb".toLowerCase();  
// 🛡️ Mot de passe admin (idéalement défini dans les variables d'env Render)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "33127";

// Tokens admin actifs en mémoire
const activeAdminTokens = new Set();

// ---------- Routes de test ----------

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Battle of Dice API up" });
});

app.get("/players", (req, res) => {
  const rows = db.prepare("SELECT * FROM players").all();
  res.json(rows);
});

// ---------- Auth / Login joueur ----------

app.post("/auth/login", (req, res) => {
  try {
    const { wallet } = req.body || {};

    if (!wallet) {
      return res.status(400).json({ error: "wallet is required" });
    }

    const walletNorm = wallet.toLowerCase();

    let player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(walletNorm);

    // Joueur non trouvé → on le crée avec des valeurs par défaut
    if (!player) {
      const insert = db.prepare(`
        INSERT INTO players (
          wallet,
          nickname,
          gems,
          vip_level,
          hp_base,
          dmg_base,
          free_rolls,
          current_player_hp,
          current_bot_hp,
          current_bot_level
        )
        VALUES (?, NULL, 0, 0, 50, 0, 5, 50, 50, 1)
      `);

      const info = insert.run(walletNorm);

      player = db
        .prepare("SELECT * FROM players WHERE id = ?")
        .get(info.lastInsertRowid);

      console.log("👤 Nouveau player créé :", player.wallet);
    }
  // --- Reset quotidien des lancers gratuits ---
  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // ⚠️ adapte le nom de la colonne si besoin :
  // ici j'assume que la colonne en DB s'appelle free_rolls
  // et la nouvelle colonne last_free_reset_at
  if (player.last_free_reset_at !== todayStr) {
    const NEW_DAILY_ROLLS = 10;

    db.prepare(`
      UPDATE players
      SET free_rolls = ?, last_free_reset_at = ?
      WHERE id = ?
    `).run(NEW_DAILY_ROLLS, todayStr, player.id);

    // mettre à jour l'objet player en mémoire aussi
    player.free_rolls = NEW_DAILY_ROLLS;
    player.last_free_reset_at = todayStr;
  }

        // On reconstruit l'inventaire de cartes à partir du JSON
    let ownedCards = {
  attack: {},
  hp: {},
  activeAttackId: null,
  activeHpId: null,
};
if (player.owned_cards_json) {
  try {
    const parsed = JSON.parse(player.owned_cards_json);
    ownedCards.attack = parsed.attack || {};
    ownedCards.hp = parsed.hp || {};
    ownedCards.activeAttackId = parsed.activeAttackId || null;
    ownedCards.activeHpId = parsed.activeHpId || null;
  } catch (e) {
    console.error("Error parsing owned_cards_json for", player.wallet, e);
  }
}


    // Réponse au front
    res.json({
      id: player.id,
      wallet: player.wallet,
      nickname: player.nickname,
      gems: player.gems,
      vipLevel: player.vip_level,
      hpBase: player.hp_base,
      dmgBase: player.dmg_base,
      freeRolls: player.free_rolls,
      currentPlayerHp: player.current_player_hp,
      currentBotHp: player.current_bot_hp,
      currentBotLevel: player.current_bot_level,
      ownedCards, // 🔥 inventaire envoyé au front
    });

  } catch (err) {
    console.error("❌ ERREUR /auth/login :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});

// ---------- Sauvegarde de l'état joueur ----------

app.post("/player/state", (req, res) => {
  try {
    const {
      wallet,
      gems,
      freeRolls,
      playerHP,
      botHP,
      currentBotLevel,
      ownedCards, // 👈 on récupère aussi les cartes
    } = req.body || {};


    if (!wallet) {
      return res.status(400).json({ error: "wallet is required" });
    }

    const walletNorm = wallet.toLowerCase();

    const player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(walletNorm);

    if (!player) {
      return res.status(404).json({ error: "player_not_found" });
    }


        // sérialiser les cartes en JSON
    let ownedCardsJson = null;
try {
  if (ownedCards) {
    const safe = {
      attack: ownedCards.attack || {},
      hp: ownedCards.hp || {},
      activeAttackId: ownedCards.activeAttackId || null,
      activeHpId: ownedCards.activeHpId || null,
    };
    ownedCardsJson = JSON.stringify(safe);
  }
} catch (e) {
  console.error("Error serializing ownedCards:", e);
}


    const stmt = db.prepare(`
      UPDATE players
      SET
        gems = COALESCE(?, gems),
        free_rolls = COALESCE(?, free_rolls),
        current_player_hp = COALESCE(?, current_player_hp),
        current_bot_hp = COALESCE(?, current_bot_hp),
        current_bot_level = COALESCE(?, current_bot_level),
        owned_cards_json = COALESCE(?, owned_cards_json),
        updated_at = datetime('now')
      WHERE wallet = ?
    `);

    stmt.run(
      typeof gems === "number" ? gems : null,
      typeof freeRolls === "number" ? freeRolls : null,
      typeof playerHP === "number" ? playerHP : null,
      typeof botHP === "number" ? botHP : null,
      typeof currentBotLevel === "number" ? currentBotLevel : null,
      ownedCardsJson,
      walletNorm
    );



    const updated = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(walletNorm);

    res.json({
      ok: true,
      player: {
        id: updated.id,
        wallet: updated.wallet,
        gems: updated.gems,
        freeRolls: updated.free_rolls,
        currentPlayerHp: updated.current_player_hp,
        currentBotHp: updated.current_bot_hp,
        currentBotLevel: updated.current_bot_level,
      },
    });
  } catch (err) {
    console.error("❌ ERREUR /player/state :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});
// ---------- Admin : login ----------
app.post("/admin/login", (req, res) => {
  try {
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({ error: "missing_password" });
    }

    if (password !== ADMIN_PASSWORD) {
      console.warn("❌ Tentative de login admin refusée.");
      return res.status(403).json({ error: "invalid_password" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    activeAdminTokens.add(token);

    return res.json({ ok: true, token });
  } catch (err) {
    console.error("❌ ERREUR /admin/login :", err);
    return res.status(500).json({ error: err.message || "internal_error" });
  }
});

// ---------- Admin : give gems ----------
app.post("/admin/give-gems", (req, res) => {  
  try {
    // 🔐 Vérification du token admin dans le header Authorization: Bearer xxxxx
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token || !activeAdminTokens.has(token)) {
      console.warn("❌ Requête admin sans token valide");
      return res.status(401).json({ error: "unauthorized_admin" });
    }

    const { targetWallet, amount } = req.body || {};

    if (!targetWallet || typeof amount !== "number") {
      return res.status(400).json({ error: "missing_fields" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }

    const targetNorm = targetWallet.toLowerCase();

    let player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(targetNorm);

    if (!player) {
      // Si le joueur n'existe pas encore, on crée un joueur de base
      const insert = db.prepare(`
        INSERT INTO players (
          wallet,
          nickname,
          gems,
          vip_level,
          hp_base,
          dmg_base,
          free_rolls,
          current_player_hp,
          current_bot_hp,
          current_bot_level
        )
        VALUES (?, NULL, 0, 0, 50, 0, 5, 50, 50, 1)
      `);

      const info = insert.run(targetNorm);
      player = db
        .prepare("SELECT * FROM players WHERE id = ?")
        .get(info.lastInsertRowid);
    }

    const update = db.prepare(
      "UPDATE players SET gems = gems + ?, updated_at = datetime('now') WHERE wallet = ?"
    );
    update.run(amount, targetNorm);

    const updated = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(targetNorm);

    console.log(
      `💎 Admin a donné ${amount} gems à ${targetNorm} (total: ${updated.gems})`
    );

    res.json({
      ok: true,
      player: {
        id: updated.id,
        wallet: updated.wallet,
        gems: updated.gems,
      },
    });
  } catch (err) {
    console.error("❌ ERREUR /admin/give-gems :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});

// ---------- Admin : set VIP level ----------
app.post("/admin/set-vip", (req, res) => {
  try {
    // 🔐 Vérification du token admin comme pour /admin/give-gems
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token || !activeAdminTokens.has(token)) {
      console.warn("❌ Requête admin VIP sans token valide");
      return res.status(401).json({ error: "unauthorized_admin" });
    }

    const { targetWallet, vipLevel } = req.body || {};

    if (!targetWallet || typeof vipLevel !== "number") {
      return res.status(400).json({ error: "missing_fields" });
    }

    if (!Number.isInteger(vipLevel) || vipLevel < 0 || vipLevel > 5) {
      return res.status(400).json({ error: "invalid_vip_level" });
    }

    const targetNorm = targetWallet.toLowerCase();

    let player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(targetNorm);

    if (!player) {
      // Si le joueur n'existe pas encore → on le crée directement avec ce VIP
      const insert = db.prepare(`
        INSERT INTO players (
          wallet,
          nickname,
          gems,
          vip_level,
          hp_base,
          dmg_base,
          free_rolls,
          current_player_hp,
          current_bot_hp,
          current_bot_level
        )
        VALUES (?, NULL, 0, ?, 50, 0, 5, 50, 50, 1)
      `);

      const info = insert.run(targetNorm, vipLevel);

      player = db
        .prepare("SELECT * FROM players WHERE id = ?")
        .get(info.lastInsertRowid);
    } else {
      db.prepare(
        "UPDATE players SET vip_level = ?, updated_at = datetime('now') WHERE wallet = ?"
      ).run(vipLevel, targetNorm);

      player = db
        .prepare("SELECT * FROM players WHERE wallet = ?")
        .get(targetNorm);
    }

    console.log(`⭐ Admin a mis le VIP ${vipLevel} à ${targetNorm}`);

    res.json({
      ok: true,
      player: {
        id: player.id,
        wallet: player.wallet,
        vipLevel: player.vip_level,
      },
    });
  } catch (err) {
    console.error("❌ ERREUR /admin/set-vip :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});






// ---------- Démarrage du serveur ----------

app.listen(PORT, () => {
  console.log(`✅ Battle of Dice API running on http://localhost:${PORT}`);
});
