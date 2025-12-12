// server.js
// Backend Battle of Dice V0

const express = require("express");
const cors = require("cors");
const crypto = require("crypto")
const { db } = require("./db");

const {
  query,
  queryOne,
  getPlayerByWallet,
  createPlayerWithWallet,
  updatePlayerState,
} = require("./db-mysql");


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

app.get("/players", async (req, res) => {
  try {
    const rows = await query(
      "SELECT * FROM players ORDER BY id DESC LIMIT 50"
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ ERREUR /players :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});


// ---------- Auth / Login joueur ----------

app.post("/auth/login", async (req, res) => {
  try {
    const { wallet } = req.body || {};

    if (!wallet) {
      return res.status(400).json({ error: "wallet is required" });
    }

    const walletNorm = wallet.toLowerCase();

    // 🔹 1) On récupère le player en MySQL
    let player = await getPlayerByWallet(walletNorm);

    // 🔹 2) S'il n'existe pas → on le crée
    if (!player) {
      player = await createPlayerWithWallet(walletNorm);
      console.log("👤 Nouveau player créé (MySQL) :", player.wallet);
    }

    // 🔹 3) Reset quotidien des free rolls (en fonction du VIP)
    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    let lastResetDate = null;
    if (player.last_free_reset_at instanceof Date) {
      // DATETIME MySQL → objet Date
      lastResetDate = player.last_free_reset_at.toISOString().slice(0, 10);
    } else if (typeof player.last_free_reset_at === "string") {
      // au cas où MySQL renverrait une string
      lastResetDate = player.last_free_reset_at.slice(0, 10);
    }

    if (lastResetDate !== todayStr) {
      const baseDailyRolls = 10;

      // Bonus VIP (rang 0 => +0, 1 => +2, ..., 5 => +10)
      let vipBonus = 0;
      switch (player.vip_level) {
        case 1:
          vipBonus = 2;
          break;
        case 2:
          vipBonus = 4;
          break;
        case 3:
          vipBonus = 6;
          break;
        case 4:
          vipBonus = 8;
          break;
        case 5:
          vipBonus = 10;
          break;
        default:
          vipBonus = 0;
      }

      const NEW_DAILY_ROLLS = baseDailyRolls + vipBonus;

      await updatePlayerState(player.id, {
        free_rolls: NEW_DAILY_ROLLS,
        last_free_reset_at: new Date(),
      });

      player.free_rolls = NEW_DAILY_ROLLS;
      player.last_free_reset_at = new Date();
    }

    // 🔹 4) Inventaire de cartes
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

    // 🔹 5) Réponse au front
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
      ownedCards,
    });
  } catch (err) {
    console.error("❌ ERREUR /auth/login :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});


// ---------- Sauvegarde de l'état joueur ----------

app.post("/player/state", async (req, res) => {
  try {
    const {
      wallet,
      gems,
      freeRolls,
      playerHP,
      botHP,
      currentBotLevel,
      ownedCards, // inventaire cartes
    } = req.body || {};

    if (!wallet) {
      return res.status(400).json({ error: "wallet is required" });
    }

    const walletNorm = wallet.toLowerCase();

    const player = await getPlayerByWallet(walletNorm);
    if (!player) {
      return res.status(404).json({ error: "player_not_found" });
    }

    // 🔸 sérialiser les cartes
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

    // 🔸 construire l'objet "fields" à mettre à jour
    const fields = {};
    if (typeof gems === "number") fields.gems = gems;
    if (typeof freeRolls === "number") fields.free_rolls = freeRolls;
    if (typeof playerHP === "number") fields.current_player_hp = playerHP;
    if (typeof botHP === "number") fields.current_bot_hp = botHP;
    if (typeof currentBotLevel === "number")
      fields.current_bot_level = currentBotLevel;
    if (ownedCardsJson !== null) fields.owned_cards_json = ownedCardsJson;

    if (Object.keys(fields).length > 0) {
      await updatePlayerState(player.id, fields);
    }

    const updated = await getPlayerByWallet(walletNorm);

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


// ---------- Rename nickname (75 gems) ----------

app.post("/player/rename", (req, res) => {
  try {
    const { wallet, nickname } = req.body || {};

    if (!wallet || typeof nickname !== "string") {
      return res.status(400).json({ error: "missing_fields" });
    }

    const walletNorm = wallet.toLowerCase();
    const trimmed = nickname.trim();

    // longueur 3–8 caractères max
    if (trimmed.length < 3 || trimmed.length > 8) {
      return res.status(400).json({ error: "invalid_length" });
    }

    const player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(walletNorm);

    if (!player) {
      return res.status(404).json({ error: "player_not_found" });
    }

    const RENAME_COST = 75;

    if (player.gems < RENAME_COST) {
      return res.status(400).json({ error: "not_enough_gems" });
    }

    db.prepare(`
      UPDATE players
      SET nickname = ?, gems = gems - ?, updated_at = datetime('now')
      WHERE wallet = ?
    `).run(trimmed, RENAME_COST, walletNorm);

    const updated = db
      .prepare(
        "SELECT id, wallet, nickname, gems, vip_level FROM players WHERE wallet = ?"
      )
      .get(walletNorm);

    res.json({
      ok: true,
      player: {
        id: updated.id,
        wallet: updated.wallet,
        nickname: updated.nickname,
        gems: updated.gems,
        vipLevel: updated.vip_level,
      },
    });
  } catch (err) {
    console.error("❌ ERREUR /player/rename :", err);
    res.status(500).json({ error: err.message || "internal_error" });
  }
});

// ---------- Rename player nickname ----------
app.post("/player/rename", (req, res) => {
  try {
    const body = req.body || {};
    const wallet = body.wallet;
    const nickname = body.nickname;

    if (!wallet || !nickname) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_fields" });
    }

    const cleanNickname = String(nickname).trim();
    if (cleanNickname.length < 3 || cleanNickname.length > 16) {
      return res.status(400).json({
        ok: false,
        error: "invalid_nickname",
      });
    }

    const walletNorm = wallet.toLowerCase();

    const player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(walletNorm);

    if (!player) {
      return res
        .status(404)
        .json({ ok: false, error: "player_not_found" });
    }

    db.prepare(
      `
      UPDATE players
      SET nickname = ?, updated_at = datetime('now')
      WHERE wallet = ?
    `
    ).run(cleanNickname, walletNorm);

    const updated = db
      .prepare(
        "SELECT wallet, nickname, gems FROM players WHERE wallet = ?"
      )
      .get(walletNorm);

    res.json({
      ok: true,
      nickname: updated.nickname,
      gems: updated.gems,
    });
  } catch (err) {
    console.error("❌ ERREUR /player/rename :", err);
    res.status(500).json({
      ok: false,
      error: err.message || "internal_error",
    });
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
app.post("/admin/give-gems", async (req, res) => {
  try {
    const { adminWallet, targetWallet, amount } = req.body || {};

    if (!adminWallet || !targetWallet || typeof amount !== "number") {
      return res.status(400).json({ error: "missing_fields" });
    }

    const adminNorm = adminWallet.toLowerCase();
    const targetNorm = targetWallet.toLowerCase();

    // Vérif ADMIN
    if (adminNorm !== ADMIN_WALLET) {
      console.warn("Tentative admin non autorisée:", adminNorm);
      return res.status(403).json({ error: "forbidden" });
    }

    let player = await getPlayerByWallet(targetNorm);
    if (!player) {
      player = await createPlayerWithWallet(targetNorm);
    }

    const newGems = (player.gems || 0) + amount;

    await updatePlayerState(player.id, { gems: newGems });

    const updated = await getPlayerByWallet(targetNorm);

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
