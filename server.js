// server.js
// Backend Battle of Dice V0

const express = require("express");
const cors = require("cors");
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

// ---------- Admin : give gems ----------

app.post("/admin/give-gems", (req, res) => {
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

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }

    let player = db
      .prepare("SELECT * FROM players WHERE wallet = ?")
      .get(targetNorm);

    if (!player) {
      // Option : on crée le joueur si pas trouvé
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
      `💎 Admin ${adminNorm} a donné ${amount} gems à ${targetNorm} (total: ${updated.gems})`
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

// ---------- Démarrage du serveur ----------

app.listen(PORT, () => {
  console.log(`✅ Battle of Dice API running on http://localhost:${PORT}`);
});
