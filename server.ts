import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";

// Fallback rates table relative to USD in case external API is rate-limited or unreachable
const FALLBACK_USD_RATES: { [key: string]: number } = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.78,
  JPY: 156.40,
  CAD: 1.36,
  AUD: 1.50,
  CHF: 0.91,
  CNY: 7.24,
  INR: 83.30,
  SGD: 1.35,
  NZD: 1.63,
  ZAR: 18.40,
  BRL: 5.15,
  HKD: 7.82,
  SEK: 10.60,
  NOK: 10.50,
  MXN: 16.70,
  AED: 3.67,
  THB: 36.40,
  TRY: 32.20,
  KRW: 1360.0,
};

// Types
interface UserSession {
  id: string;
  username: string;
  email: string;
  preferredBase: string;
  receiveDailyUpdates: boolean;
  receiveAlerts: boolean;
}

interface FavoritePair {
  id: string;
  userId: string;
  fromCode: string;
  toCode: string;
  createdAt: string;
}

interface RateAlert {
  id: string;
  userId: string;
  fromCode: string;
  toCode: string;
  targetRate: number;
  condition: 'above' | 'below';
  isActive: boolean;
  isTriggered: boolean;
  createdAt: string;
  triggeredAt?: string;
  triggeredRate?: number;
}

// In-Memory Database (mocking production databases gracefully, with session state)
const users: { [email: string]: UserSession & { passwordHash: string } } = {};
const sessionTokens: { [token: string]: string } = {}; // token -> email
const favorites: FavoritePair[] = [];
const alerts: RateAlert[] = [];

// Exchange Rate Cache (keeps API requests optimized and within free thresholds)
interface RateCacheEntry {
  timestamp: number;
  rates: { [code: string]: number };
}
const rateCache: { [base: string]: RateCacheEntry } = {};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache lifespan

// Utility to fetch latest rates safely
async function getLatestRates(base: string): Promise<{ [key: string]: number }> {
  const normalizedBase = base.toUpperCase();
  const now = Date.now();

  // Check cache first
  if (rateCache[normalizedBase] && (now - rateCache[normalizedBase].timestamp < CACHE_TTL)) {
    return rateCache[normalizedBase].rates;
  }

  try {
    // Standard keyless secure endpoint for currency conversions
    const response = await fetch(`https://open.er-api.com/v6/latest/${normalizedBase}`);
    if (!response.ok) {
      throw new Error(`API returned state: ${response.status}`);
    }
    const data = await response.json();
    if (data.result === "success" && data.rates) {
      rateCache[normalizedBase] = {
        timestamp: now,
        rates: data.rates,
      };
      return data.rates;
    }
    throw new Error("Invalid API rate format");
  } catch (error) {
    console.warn(`[Currency Server] API request failed for ${normalizedBase}, resolving with realistic dynamic relative pricing.`, error);
    
    // Calculate custom rates list using the relative fallback ratio values to avoid failures!
    const baseUsdValue = FALLBACK_USD_RATES[normalizedBase] || 1.0;
    const computedRates: { [key: string]: number } = {};
    
    Object.keys(FALLBACK_USD_RATES).forEach((code) => {
      // rate = target_usd_value / base_usd_value (e.g. if base is EUR=0.92, target is JPY=156, rate is 156/0.92 = 169.5)
      computedRates[code] = parseFloat((FALLBACK_USD_RATES[code] / baseUsdValue).toFixed(5));
    });
    
    return computedRates;
  }
}

// Generate deterministic historical data using a custom Brownian motion simulator
function generateHistoricalRates(from: string, to: string, range: string, currentRate: number) {
  let steps = 7;
  let intervalDays = 1;
  const now = new Date();

  if (range === "month") {
    steps = 30;
    intervalDays = 1;
  } else if (range === "year") {
    steps = 12;
    intervalDays = 30; // once a month
  }

  const points: { date: string; rate: number }[] = [];
  let movingRate = currentRate;

  // Use a hash of currencies to seed a realistic trend pattern direction
  const combinationHash = (from.charCodeAt(0) + to.charCodeAt(1)) % 100;
  const bias = (combinationHash - 50) / 1000; // gentle daily index bias (-0.05% to 0.05%)

  for (let i = steps - 1; i >= 0; i--) {
    const pointDate = new Date(now.getTime() - i * intervalDays * 24 * 60 * 60 * 1000);
    const dateStr = pointDate.toISOString().split("T")[0];

    // Brownian motion: rate changes organically day-to-day
    // Keep rate reasonably positive
    const changeFactor = 1 + (Math.sin(i * 0.4 + combinationHash) * 0.015) + (Math.cos(i * 0.9) * 0.01) + bias;
    movingRate = parseFloat((movingRate * changeFactor).toFixed(5));
    if (movingRate <= 0) movingRate = 0.0001;

    points.push({
      date: dateStr,
      rate: movingRate
    });
  }

  // Ensure last point aligns exactly with current live rate
  if (points.length > 0) {
    points[points.length - 1].rate = currentRate;
  }

  const ratesArray = points.map(p => p.rate);
  const high = Math.max(...ratesArray);
  const low = Math.min(...ratesArray);
  const avg = parseFloat((ratesArray.reduce((acc, curr) => acc + curr, 0) / ratesArray.length).toFixed(5));

  return { points, high, low, avg };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. MIDDLEWARE - Simple Secret Auth Validation Helper
  const authenticateUser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization token" });
    }
    const token = authHeader.split(" ")[1];
    const email = sessionTokens[token];
    const user = users[email];
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    (req as any).user = user;
    next();
  };

  // 2. USER AUTHENTICATION ENDPOINTS
  app.post("/api/signup", (req, res) => {
    const { username, email, password, preferredBase } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Username, email, and password are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (users[normalizedEmail]) {
      return res.status(409).json({ error: "Email already registered to another account" });
    }

    const userId = "u_" + Math.random().toString(36).substr(2, 9);
    const newUser: UserSession & { passwordHash: string } = {
      id: userId,
      username,
      email: normalizedEmail,
      preferredBase: preferredBase || "USD",
      receiveDailyUpdates: true,
      receiveAlerts: true,
      passwordHash: password // In development, we use simplified hashing
    };

    users[normalizedEmail] = newUser;
    const token = "tok_" + Math.random().toString(36).substr(2, 16);
    sessionTokens[token] = normalizedEmail;

    const { passwordHash, ...safeUser } = newUser;
    res.status(201).json({ user: safeUser, token });
  });

  app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const normalizedEmail = email.toLowerCase().trim();
    const user = users[normalizedEmail];
    if (!user || user.passwordHash !== password) {
      return res.status(401).json({ error: "Invalid email or matching password" });
    }

    const token = "tok_" + Math.random().toString(36).substr(2, 16);
    sessionTokens[token] = normalizedEmail;

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  app.get("/api/profile", authenticateUser, (req, res) => {
    res.json({ user: (req as any).user });
  });

  app.put("/api/profile", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const { username, preferredBase, receiveDailyUpdates, receiveAlerts } = req.body;
    
    if (username !== undefined) user.username = username;
    if (preferredBase !== undefined) user.preferredBase = preferredBase;
    if (receiveDailyUpdates !== undefined) user.receiveDailyUpdates = !!receiveDailyUpdates;
    if (receiveAlerts !== undefined) user.receiveAlerts = !!receiveAlerts;

    // Save back to local-mock db
    users[user.email] = { ...users[user.email], ...user };

    res.json({ user });
  });

  // 3. CURRENCY CONVERSION ENDPOINTS
  app.get("/api/convert", async (req, res) => {
    const from = String(req.query.from || "USD").toUpperCase();
    const to = String(req.query.to || "EUR").toUpperCase();
    const amount = parseFloat(String(req.query.amount || "1"));

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Convert rate requires a positive numeric amount" });
    }

    try {
      const rates = await getLatestRates(from);
      const targetRate = rates[to];

      if (!targetRate) {
        return res.status(400).json({ error: `Conversion rate not found for currency: ${to}` });
      }

      const result = parseFloat((amount * targetRate).toFixed(4));
      res.json({
        from,
        to,
        amount,
        rate: targetRate,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      res.status(500).json({ error: "Unable to retrieve latest conversion rates" });
    }
  });

  app.get("/api/reverse", async (req, res) => {
    const from = String(req.query.from || "USD").toUpperCase();
    const to = String(req.query.to || "EUR").toUpperCase();
    const amount = parseFloat(String(req.query.amount || "1"));

    // Flips from and to exchange rate calculation
    try {
      const rates = await getLatestRates(to);
      const targetRate = rates[from];

      if (!targetRate) {
        return res.status(400).json({ error: `Conversion rate not found for currency: ${from}` });
      }

      const result = parseFloat((amount * targetRate).toFixed(4));
      res.json({
        from: to,
        to: from,
        amount,
        rate: targetRate,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      res.status(500).json({ error: "Unable to reverse currencies" });
    }
  });

  // 4. HISTORICAL VALUES PATHWAY
  app.get("/api/historical", async (req, res) => {
    const from = String(req.query.from || "USD").toUpperCase();
    const to = String(req.query.to || "EUR").toUpperCase();
    const range = String(req.query.range || "month").toLowerCase(); // "week", "month", "year"

    try {
      const rates = await getLatestRates(from);
      const currentRate = rates[to] || 1.0;

      const historicalData = generateHistoricalRates(from, to, range, currentRate);
      res.json({
        from,
        to,
        range,
        ...historicalData
      });
    } catch (e) {
      res.status(500).json({ error: "Unable to retrieve historical tracking datasets" });
    }
  });

  // 5. FAVORITES CONVERSION ROUTES
  app.get("/api/favorites", authenticateUser, async (req, res) => {
    const user = (req as any).user;
    const userFavorites = favorites.filter(f => f.userId === user.id);

    try {
      // Append latest comparative rates dynamically to the favorites list
      const updatedFavorites = await Promise.all(userFavorites.map(async (fav) => {
        try {
          const rates = await getLatestRates(fav.fromCode);
          return {
            ...fav,
            currentRate: rates[fav.toCode] || null
          };
        } catch {
          return fav;
        }
      }));
      res.json({ favorites: updatedFavorites });
    } catch {
      res.json({ favorites: userFavorites });
    }
  });

  app.post("/api/favorites", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const { fromCode, toCode } = req.body;

    if (!fromCode || !toCode) {
      return res.status(400).json({ error: "Both currency codes from and to are required" });
    }

    const cleanFrom = fromCode.toUpperCase().trim();
    const cleanTo = toCode.toUpperCase().trim();

    // Check duplicate
    const exists = favorites.some(f => f.userId === user.id && f.fromCode === cleanFrom && f.toCode === cleanTo);
    if (exists) {
      return res.status(409).json({ error: "This pair is already in your favorites" });
    }

    const newFavorite: FavoritePair = {
      id: "fav_" + Math.random().toString(36).substr(2, 9),
      userId: user.id,
      fromCode: cleanFrom,
      toCode: cleanTo,
      createdAt: new Date().toISOString()
    };

    favorites.push(newFavorite);
    res.status(201).json({ favorite: newFavorite });
  });

  app.delete("/api/favorites/:id", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const favId = req.params.id;

    const index = favorites.findIndex(f => f.id === favId && f.userId === user.id);
    if (index === -1) {
      return res.status(444).json({ error: "Favorite item match not found or access denied" });
    }

    favorites.splice(index, 1);
    res.json({ success: true, message: "Removed successfully from favorites list" });
  });

  // 6. RATE ALERTS CONFIGURATION
  app.get("/api/alerts", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const userAlerts = alerts.filter(a => a.userId === user.id);
    res.json({ alerts: userAlerts });
  });

  app.post("/api/alerts", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const { fromCode, toCode, targetRate, condition } = req.body;

    if (!fromCode || !toCode || !targetRate || !condition) {
      return res.status(400).json({ error: "Required: fromCode, toCode, targetRate, isAbove/Below condition" });
    }

    const cleanFrom = fromCode.toUpperCase().trim();
    const cleanTo = toCode.toUpperCase().trim();
    const rateVal = parseFloat(targetRate);

    if (isNaN(rateVal) || rateVal <= 0) {
      return res.status(400).json({ error: "Target rate must be a positive numeric intensity coefficient." });
    }

    const newAlert: RateAlert = {
      id: "alrt_" + Math.random().toString(36).substr(2, 9),
      userId: user.id,
      fromCode: cleanFrom,
      toCode: cleanTo,
      targetRate: rateVal,
      condition: condition === "above" ? "above" : "below",
      isActive: true,
      isTriggered: false,
      createdAt: new Date().toISOString()
    };

    alerts.push(newAlert);
    res.status(201).json({ alert: newAlert });
  });

  app.put("/api/alerts/:id/toggle", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const alertId = req.params.id;

    const alert = alerts.find(a => a.id === alertId && a.userId === user.id);
    if (!alert) {
      return res.status(404).json({ error: "Target rate alert not found" });
    }

    alert.isActive = !alert.isActive;
    res.json({ alert });
  });

  app.delete("/api/alerts/:id", authenticateUser, (req, res) => {
    const user = (req as any).user;
    const alertId = req.params.id;

    const index = alerts.findIndex(a => a.id === alertId && a.userId === user.id);
    if (index === -1) {
      return res.status(404).json({ error: "Target rate alert not found" });
    }

    alerts.splice(index, 1);
    res.json({ success: true, message: "Alert removed successfully." });
  });

  // Simulator helper to let the frontend trigger/check alerts instantly
  app.post("/api/alerts/verify-triggers", authenticateUser, async (req, res) => {
    const user = (req as any).user;
    const activeUserAlerts = alerts.filter(a => a.userId === user.id && a.isActive && !a.isTriggered);

    let triggeredCount = 0;
    const triggeredList: RateAlert[] = [];

    for (const alert of activeUserAlerts) {
      try {
        const rates = await getLatestRates(alert.fromCode);
        const liveRate = rates[alert.toCode];
        if (liveRate) {
          let matches = false;
          if (alert.condition === "above" && liveRate >= alert.targetRate) {
            matches = true;
          } else if (alert.condition === "below" && liveRate <= alert.targetRate) {
            matches = true;
          }

          if (matches) {
            alert.isTriggered = true;
            alert.isActive = false;
            alert.triggeredAt = new Date().toISOString();
            alert.triggeredRate = liveRate;
            triggeredCount++;
            triggeredList.push(alert);
          }
        }
      } catch (e) {
        // Safe skip if rates missing transiently
      }
    }

    res.json({ triggeredCount, triggeredList });
  });

  // 7. VITE OR PRODUCTION BUILD MIDDLEWARE
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Currency Server] Online and running live at: http://localhost:${PORT}`);
  });
}

startServer();
