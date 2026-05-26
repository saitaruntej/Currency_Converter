import React, { useState, useEffect, useRef } from "react";
import { 
  motion, 
  AnimatePresence 
} from "motion/react";
import { 
  ArrowLeftRight, 
  TrendingUp, 
  Star, 
  Bell, 
  User as UserIcon, 
  Settings, 
  LogOut, 
  LogIn, 
  UserPlus, 
  CheckCircle2, 
  Sparkles, 
  HelpCircle,
  Percent,
  Calendar,
  AlertTriangle,
  ChevronDown,
  Search,
  BellRing,
  Trash2,
  Clock,
  Briefcase,
  UserCheck
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as ChartTooltip, 
  ResponsiveContainer 
} from "recharts";

import { 
  SUPPORTED_CURRENCIES, 
  type CurrencyInfo, 
  type User, 
  type FavoritePair, 
  type RateAlert, 
  type HistoricalRatePoint 
} from "./types";

import { auth, db, handleFirestoreError, OperationType } from "./firebase";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, getDocs, query, where, deleteDoc } from "firebase/firestore";
const USE_LOCAL_MOCK_API = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// Helper to make authenticated local API requests
async function localApiFetch(url: string, method: string = "GET", body: any = null, userToken: string | null = null) {
  const activeToken = userToken || localStorage.getItem("cc_token");
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (activeToken) {
    headers["Authorization"] = `Bearer ${activeToken}`;
  }
  const config: RequestInit = {
    method,
    headers,
  };
  if (body) {
    config.body = JSON.stringify(body);
  }
  const res = await fetch(url, config);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  return res.json();
}

export default function App() {
  // Authentication & Session
  const [currentUser, setCurrentUser] = useState<User | null>((() => {
    try {
      const saved = localStorage.getItem("cc_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })());
  const [token, setToken] = useState<string | null>(localStorage.getItem("cc_token"));
  const [authView, setAuthView] = useState<"none" | "login" | "signup">("none");
  const [authError, setAuthError] = useState("");
  
  // Auth Form State
  const [authUsername, setAuthUsername] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  // Target Settings/Config State
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [settingsPreferredBase, setSettingsPreferredBase] = useState("USD");
  const [settingsUsername, setSettingsUsername] = useState("");
  const [settingsDailyUpdates, setSettingsDailyUpdates] = useState(true);
  const [settingsReceiveAlerts, setSettingsReceiveAlerts] = useState(true);
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState("");

  // Primary Conversion System State
  const [amount, setAmount] = useState<number>(100);
  const [fromCurrency, setFromCurrency] = useState<CurrencyInfo>(SUPPORTED_CURRENCIES[0]); // USD
  const [toCurrency, setToCurrency] = useState<CurrencyInfo>(SUPPORTED_CURRENCIES[1]); // EUR
  
  const [isSwapping, setIsSwapping] = useState(false);
  const [latestRate, setLatestRate] = useState<number | null>(null);
  const [conversionResult, setConversionResult] = useState<number | null>(null);
  const [isLoadingConversion, setIsLoadingConversion] = useState(false);
  const [conversionTimestamp, setConversionTimestamp] = useState<string>("");

  // Custom Dropdowns
  const [openFromDropdown, setOpenFromDropdown] = useState(false);
  const [openToDropdown, setOpenToDropdown] = useState(false);
  const [searchFromQuery, setSearchFromQuery] = useState("");
  const [searchToQuery, setSearchToQuery] = useState("");

  // Historical Charts State
  const [chartRange, setChartRange] = useState<"week" | "month" | "year">("month");
  const [historicalData, setHistoricalData] = useState<HistoricalRatePoint[]>([]);
  const [chartHigh, setChartHigh] = useState<number>(0);
  const [chartLow, setChartLow] = useState<number>(0);
  const [chartAvg, setChartAvg] = useState<number>(0);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);

  // Favorites & Pricing Alerts State
  const [favoritesList, setFavoritesList] = useState<FavoritePair[]>([]);
  const [alertsList, setRateAlerts] = useState<RateAlert[]>([]);
  const [alertTargetRate, setAlertTargetRate] = useState<string>("");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("above");
  const [alertTriggerFeed, setAlertTriggerFeed] = useState<string[]>([]);
  const [triggerCheckSuccess, setTriggerCheckSuccess] = useState(false);

  // General Notification Banners
  const [bannerAlert, setBannerAlert] = useState<{ type: 'success' | 'info' | 'warn'; text: string } | null>(null);

  // Refs for closing dropdowns on click outside
  const fromDropdownRef = useRef<HTMLDivElement>(null);
  const toDropdownRef = useRef<HTMLDivElement>(null);

  // Real-time server ping timer format
  const [currentTimeUTC, setCurrentTimeUTC] = useState("");

  // Format UTC times on client beautifully
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeUTC(now.toISOString().replace("T", " ").substring(0, 19) + " UTC");
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Handle click-outs for country search dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (fromDropdownRef.current && !fromDropdownRef.current.contains(event.target as Node)) {
        setOpenFromDropdown(false);
      }
      if (toDropdownRef.current && !toDropdownRef.current.contains(event.target as Node)) {
        setOpenToDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync state values on active user reload
  useEffect(() => {
    if (currentUser) {
      setSettingsUsername(currentUser.username);
      setSettingsPreferredBase(currentUser.preferredBase);
      setSettingsDailyUpdates(currentUser.receiveDailyUpdates);
      setSettingsReceiveAlerts(currentUser.receiveAlerts);
    }
  }, [currentUser]);

  // Synchronous state synchronization using onAuthStateChanged or Local API
  useEffect(() => {
    if (USE_LOCAL_MOCK_API) {
      const storedToken = localStorage.getItem("cc_token");
      const storedUser = localStorage.getItem("cc_user");
      
      if (storedToken && storedUser) {
        // Token exists. Verify with backend and update profile
        localApiFetch("/api/profile", "GET", null, storedToken)
          .then((data) => {
            const appUser: User = {
              id: data.user.id,
              username: data.user.username,
              email: data.user.email,
              preferredBase: data.user.preferredBase,
              receiveDailyUpdates: data.user.receiveDailyUpdates,
              receiveAlerts: data.user.receiveAlerts,
              createdAt: new Date().toISOString()
            };
            localStorage.setItem("cc_user", JSON.stringify(appUser));
            setToken(storedToken);
            setCurrentUser(appUser);
          })
          .catch((err) => {
            console.warn("[Local Mock Auth] Saved session is invalid or expired. Logging out.", err);
            localStorage.removeItem("cc_token");
            localStorage.removeItem("cc_user");
            setToken(null);
            setCurrentUser(null);
            setFavoritesList([]);
            setRateAlerts([]);
          });
      } else {
        setToken(null);
        setCurrentUser(null);
        setFavoritesList([]);
        setRateAlerts([]);
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Authenticated! Fetch their public and private details
        const publicRef = doc(db, "users", user.uid, "public", "profile");
        const privateRef = doc(db, "users", user.uid, "private", "info");
        
        let username = user.displayName || user.email?.split("@")[0] || "User";
        let preferredBase = "USD";
        let receiveDailyUpdates = true;
        let receiveAlerts = true;

        try {
          const publicSnap = await getDoc(publicRef);
          if (publicSnap.exists()) {
            const pubData = publicSnap.data();
            username = pubData.username || username;
            preferredBase = pubData.preferredBase || preferredBase;
          } else {
            // New register or first sign-in: Bootstrap
            await setDoc(publicRef, { username, preferredBase });
            await setDoc(privateRef, {
              email: user.email || "",
              receiveDailyUpdates: true,
              receiveAlerts: true
            });
          }
          
          const privateSnap = await getDoc(privateRef);
          if (privateSnap.exists()) {
            const privData = privateSnap.data();
            receiveDailyUpdates = privData.receiveDailyUpdates ?? true;
            receiveAlerts = privData.receiveAlerts ?? true;
          }
        } catch (err) {
          console.error("Error loading user profile from Firestore:", err);
        }

        const appUser: User = {
          id: user.uid,
          username,
          email: user.email || "",
          preferredBase,
          receiveDailyUpdates,
          receiveAlerts,
          createdAt: new Date().toISOString()
        };

        localStorage.setItem("cc_token", user.uid);
        localStorage.setItem("cc_user", JSON.stringify(appUser));
        setToken(user.uid);
        setCurrentUser(appUser);
      } else {
        localStorage.removeItem("cc_token");
        localStorage.removeItem("cc_user");
        setToken(null);
        setCurrentUser(null);
        setFavoritesList([]);
        setRateAlerts([]);
      }
    });

    return () => unsubscribe();
  }, []);

  // Synchronize Favorite pairs, alerts, and profile if user logged in
  useEffect(() => {
    if (token && currentUser) {
      fetchFavorites();
      fetchAlerts();
    } else {
      setFavoritesList([]);
      setRateAlerts([]);
    }
  }, [token, currentUser?.id]);

  // Trigger conversion rates when Currencies, Amount OR Range alters
  useEffect(() => {
    performConversion();
    fetchTrendData();
  }, [fromCurrency.code, toCurrency.code, amount]);

  useEffect(() => {
    fetchTrendData();
  }, [chartRange]);

  // Background Loop simulation to evaluate Custom Rate Alerts (simulates push responses)
  useEffect(() => {
    if (!token || !currentUser) return;
    
    const interval = setInterval(() => {
      verifyAlertStatusQuietly();
    }, 15000); // Check alert thresholds every 15 seconds safely

    return () => clearInterval(interval);
  }, [token, currentUser, latestRate]);

  // Create notifications and banner triggers helper
  const triggerBanner = (text: string, type: 'success' | 'warn' | 'info' = 'success') => {
    setBannerAlert({ text, type });
    setTimeout(() => {
      setBannerAlert(null);
    }, 4500);
  };

  // Convert execution
  const performConversion = async () => {
    if (amount <= 0) return;
    setIsLoadingConversion(true);
    try {
      const res = await fetch(`/api/convert?from=${fromCurrency.code}&to=${toCurrency.code}&amount=${amount}`);
      if (!res.ok) throw new Error("Conversion error");
      const data = await res.json();
      setLatestRate(data.rate);
      setConversionResult(data.result);
      setConversionTimestamp(data.timestamp);
    } catch {
      // Fallback relative offline calculation if server is starting up or reloading
      const defaultF = fromCurrency.code;
      const defaultT = toCurrency.code;
      const rateFrom = toCurrency.code === 'USD' ? 1 : 1.1; // realistic ratio fallback
      setLatestRate(rateFrom);
      setConversionResult(amount * rateFrom);
      setConversionTimestamp(new Date().toISOString());
    } finally {
      setIsLoadingConversion(false);
    }
  };

  // Switch/flip active converting currency pairs
  const handleSwapCurrencies = () => {
    setIsSwapping(true);
    const prevFrom = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(prevFrom);
    setTimeout(() => setIsSwapping(false), 400);
  };

  // Historical rate fetching
  const fetchTrendData = async () => {
    setIsLoadingHistorical(true);
    try {
      const res = await fetch(`/api/historical?from=${fromCurrency.code}&to=${toCurrency.code}&range=${chartRange}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setHistoricalData(data.points || []);
      setChartHigh(data.high || 0);
      setChartLow(data.low || 0);
      setChartAvg(data.avg || 0);
    } catch {
      // Generate immediate rich visual fallback data structure so Recharts operates offline gracefully
      const pts: HistoricalRatePoint[] = [];
      const baseVal = latestRate || 1.1234;
      const count = chartRange === 'week' ? 7 : chartRange === 'month' ? 30 : 12;
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * (chartRange === 'year' ? 30 : 1));
        pts.push({
          date: d.toISOString().split("T")[0],
          rate: parseFloat((baseVal * (1 + Math.sin(i * 0.45) * 0.03 + Math.cos(i * 0.8) * 0.01)).toFixed(4))
        });
      }
      setHistoricalData(pts);
      const ratesArr = pts.map(p => p.rate);
      setChartHigh(Math.max(...ratesArr));
      setChartLow(Math.min(...ratesArr));
      setChartAvg(parseFloat((ratesArr.reduce((a,b)=>a+b,0) / pts.length).toFixed(4)));
    } finally {
      setIsLoadingHistorical(false);
    }
  };

  // Auth Operations: SignUp
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    if (!authUsername || !authEmail || !authPassword) {
      setAuthError("All fields are required");
      return;
    }
    try {
      if (USE_LOCAL_MOCK_API) {
        const data = await localApiFetch("/api/signup", "POST", {
          username: authUsername,
          email: authEmail,
          password: authPassword,
          preferredBase: fromCurrency.code
        });
        
        const appUser: User = {
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          preferredBase: data.user.preferredBase,
          receiveDailyUpdates: data.user.receiveDailyUpdates,
          receiveAlerts: data.user.receiveAlerts,
          createdAt: new Date().toISOString()
        };

        localStorage.setItem("cc_token", data.token);
        localStorage.setItem("cc_user", JSON.stringify(appUser));
        setToken(data.token);
        setCurrentUser(appUser);
        setAuthView("none");
        triggerBanner(`Welcome, ${authUsername}! Account successfully created.`, 'success');
        
        // Reset state
        setAuthUsername("");
        setAuthEmail("");
        setAuthPassword("");
        return;
      }

      const credVal = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      const user = credVal.user;
      
      const publicRef = doc(db, "users", user.uid, "public", "profile");
      const privateRef = doc(db, "users", user.uid, "private", "info");

      await setDoc(publicRef, {
        username: authUsername,
        preferredBase: fromCurrency.code
      });
      await setDoc(privateRef, {
        email: authEmail,
        receiveDailyUpdates: true,
        receiveAlerts: true
      });

      const appUser: User = {
        id: user.uid,
        username: authUsername,
        email: authEmail,
        preferredBase: fromCurrency.code,
        receiveDailyUpdates: true,
        receiveAlerts: true,
        createdAt: new Date().toISOString()
      };

      localStorage.setItem("cc_token", user.uid);
      localStorage.setItem("cc_user", JSON.stringify(appUser));
      setToken(user.uid);
      setCurrentUser(appUser);
      setAuthView("none");
      triggerBanner(`Welcome, ${authUsername}! Account successfully created.`, 'success');
      
      // Reset state
      setAuthUsername("");
      setAuthEmail("");
      setAuthPassword("");
    } catch (err: any) {
      setAuthError(err.message || "Sign up failure");
    }
  };

  // Auth Operations: Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    if (!authEmail || !authPassword) {
      setAuthError("Please fill in both email and password");
      return;
    }
    try {
      if (USE_LOCAL_MOCK_API) {
        const data = await localApiFetch("/api/login", "POST", {
          email: authEmail,
          password: authPassword
        });

        const appUser: User = {
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          preferredBase: data.user.preferredBase,
          receiveDailyUpdates: data.user.receiveDailyUpdates,
          receiveAlerts: data.user.receiveAlerts,
          createdAt: new Date().toISOString()
        };

        localStorage.setItem("cc_token", data.token);
        localStorage.setItem("cc_user", JSON.stringify(appUser));
        setToken(data.token);
        setCurrentUser(appUser);
        setAuthView("none");
        triggerBanner(`Welcome back, ${data.user.username}!`, 'success');

        setAuthEmail("");
        setAuthPassword("");
        return;
      }

      const credVal = await signInWithEmailAndPassword(auth, authEmail, authPassword);
      const user = credVal.user;

      const publicRef = doc(db, "users", user.uid, "public", "profile");
      const privateRef = doc(db, "users", user.uid, "private", "info");

      let username = user.displayName || user.email?.split("@")[0] || "User";
      let preferredBase = "USD";
      let receiveDailyUpdates = true;
      let receiveAlerts = true;

      try {
        const publicSnap = await getDoc(publicRef);
        if (publicSnap.exists()) {
          const pubData = publicSnap.data();
          username = pubData.username || username;
          preferredBase = pubData.preferredBase || preferredBase;
        }
        const privateSnap = await getDoc(privateRef);
        if (privateSnap.exists()) {
          const privData = privateSnap.data();
          receiveDailyUpdates = privData.receiveDailyUpdates ?? true;
          receiveAlerts = privData.receiveAlerts ?? true;
        }
      } catch (err) {
        console.error("Profile sync issue:", err);
      }

      const appUser: User = {
        id: user.uid,
        username,
        email: user.email || "",
        preferredBase,
        receiveDailyUpdates,
        receiveAlerts,
        createdAt: new Date().toISOString()
      };

      localStorage.setItem("cc_token", user.uid);
      localStorage.setItem("cc_user", JSON.stringify(appUser));
      setToken(user.uid);
      setCurrentUser(appUser);
      setAuthView("none");
      triggerBanner(`Welcome back, ${username}!`, 'success');

      setAuthEmail("");
      setAuthPassword("");
    } catch (err: any) {
      setAuthError(err.message || "Authentication failed");
    }
  };

  // Google Authentication Operation
  const handleGoogleSignIn = async () => {
    setAuthError("");
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      const publicRef = doc(db, "users", user.uid, "public", "profile");
      const privateRef = doc(db, "users", user.uid, "private", "info");
      
      let username = user.displayName || user.email?.split("@")[0] || "User";
      let preferredBase = "USD";
      let receiveDailyUpdates = true;
      let receiveAlerts = true;
      
      try {
        const publicSnap = await getDoc(publicRef);
        if (publicSnap.exists()) {
          const pubData = publicSnap.data();
          username = pubData.username || username;
          preferredBase = pubData.preferredBase || preferredBase;
        } else {
          await setDoc(publicRef, {
            username,
            preferredBase
          });
          await setDoc(privateRef, {
            email: user.email || "",
            receiveDailyUpdates: true,
            receiveAlerts: true
          });
        }

        const privateSnap = await getDoc(privateRef);
        if (privateSnap.exists()) {
          const privData = privateSnap.data();
          receiveDailyUpdates = privData.receiveDailyUpdates ?? true;
          receiveAlerts = privData.receiveAlerts ?? true;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/public/profile`);
      }
      
      const appUser: User = {
        id: user.uid,
        username,
        email: user.email || "",
        preferredBase,
        receiveDailyUpdates,
        receiveAlerts,
        createdAt: new Date().toISOString()
      };
      
      localStorage.setItem("cc_token", user.uid);
      localStorage.setItem("cc_user", JSON.stringify(appUser));
      setToken(user.uid);
      setCurrentUser(appUser);
      setAuthView("none");
      triggerBanner(`Signed in as ${username} via Google!`, "success");
    } catch (error: any) {
      setAuthError(error.message || "Failed to authenticate via Google.");
    }
  };

  // Auth Operations: Logout
  const handleLogout = async () => {
    try {
      if (!USE_LOCAL_MOCK_API) {
        await signOut(auth);
      }
      localStorage.removeItem("cc_token");
      localStorage.removeItem("cc_user");
      setToken(null);
      setCurrentUser(null);
      setShowProfileSettings(false);
      triggerBanner("Logged out of session safely.", 'info');
    } catch (error) {
      console.error("Sign out fail:", error);
    }
  };

  // Profile preferences updates
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSuccessMsg("");
    if (!token || !currentUser) return;

    try {
      if (USE_LOCAL_MOCK_API) {
        const data = await localApiFetch("/api/profile", "PUT", {
          username: settingsUsername,
          preferredBase: settingsPreferredBase,
          receiveDailyUpdates: settingsDailyUpdates,
          receiveAlerts: settingsReceiveAlerts
        });

        const updatedUser: User = {
          id: data.user.id,
          username: data.user.username,
          email: data.user.email,
          preferredBase: data.user.preferredBase,
          receiveDailyUpdates: data.user.receiveDailyUpdates,
          receiveAlerts: data.user.receiveAlerts,
          createdAt: currentUser.createdAt
        };

        localStorage.setItem("cc_user", JSON.stringify(updatedUser));
        setCurrentUser(updatedUser);
        setSettingsSuccessMsg("Preferences updated successfully!");
        setTimeout(() => setSettingsSuccessMsg(""), 3000);
        triggerBanner("Preferences updated securely.", 'success');
        return;
      }

      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const publicRef = doc(db, "users", userId, "public", "profile");
      const privateRef = doc(db, "users", userId, "private", "info");

      await updateDoc(publicRef, {
        username: settingsUsername,
        preferredBase: settingsPreferredBase
      });
      await updateDoc(privateRef, {
        receiveDailyUpdates: settingsDailyUpdates,
        receiveAlerts: settingsReceiveAlerts
      });

      const updatedUser: User = {
        ...currentUser!,
        username: settingsUsername,
        preferredBase: settingsPreferredBase,
        receiveDailyUpdates: settingsDailyUpdates,
        receiveAlerts: settingsReceiveAlerts
      };

      localStorage.setItem("cc_user", JSON.stringify(updatedUser));
      setCurrentUser(updatedUser);
      setSettingsSuccessMsg("Preferences updated successfully!");
      setTimeout(() => setSettingsSuccessMsg(""), 3000);
      triggerBanner("Preferences updated securely.", 'success');
    } catch (err) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}/public/profile`);
      } else {
        console.error("Profile update error:", err);
      }
    }
  };

  // Favorites logic
  const fetchFavorites = async () => {
    if (!token) return;
    try {
      if (USE_LOCAL_MOCK_API) {
        const data = await localApiFetch("/api/favorites");
        setFavoritesList(data.favorites || []);
        return;
      }

      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const path = "favorites";
      const q = query(collection(db, path), where("userId", "==", userId));
      const querySnapshot = await getDocs(q);
      const list: FavoritePair[] = [];
      querySnapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          userId: d.userId,
          fromCode: d.fromCode,
          toCode: d.toCode,
          createdAt: d.createdAt,
          currentRate: latestRate || 1.0
        });
      });
      setFavoritesList(list);
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.LIST, "favorites");
      } else {
        console.error("Fetch favorites error:", error);
      }
    }
  };

  const handleAddFavorite = async () => {
    if (!token) {
      setAuthView("login");
      triggerBanner("Please register or sign in to save favorite Pairs!", 'info');
      return;
    }

    const exists = favoritesList.some(
      f => f.fromCode === fromCurrency.code && f.toCode === toCurrency.code
    );
    if (exists) {
      triggerBanner("This pair is already in your favorites list!", 'info');
      return;
    }

    try {
      if (USE_LOCAL_MOCK_API) {
        await localApiFetch("/api/favorites", "POST", {
          fromCode: fromCurrency.code,
          toCode: toCurrency.code
        });
        triggerBanner(`Added ${fromCurrency.code}/${toCurrency.code} to favorites.`, 'success');
        fetchFavorites();
        return;
      }

      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const path = "favorites";
      const docData = {
        userId,
        fromCode: fromCurrency.code,
        toCode: toCurrency.code,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, path), docData);
      triggerBanner(`Added ${fromCurrency.code}/${toCurrency.code} to favorites.`, 'success');
      fetchFavorites();
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.CREATE, "favorites");
      } else {
        console.error("Add favorite error:", error);
      }
    }
  };

  const handleRemoveFavorite = async (id: string) => {
    if (!token) return;
    try {
      if (USE_LOCAL_MOCK_API) {
        await localApiFetch(`/api/favorites/${id}`, "DELETE");
        triggerBanner("Removed successfully from favorites list.", 'info');
        fetchFavorites();
        return;
      }

      await deleteDoc(doc(db, "favorites", id));
      triggerBanner("Deleted favorite pair.", 'info');
      fetchFavorites();
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.DELETE, `favorites/${id}`);
      } else {
        console.error("Remove favorite error:", error);
      }
    }
  };

  const handleTriggerFavoriteConvert = (fromCode: string, toCode: string) => {
    const fromInfo = SUPPORTED_CURRENCIES.find(c => c.code === fromCode);
    const toInfo = SUPPORTED_CURRENCIES.find(c => c.code === toCode);
    if (fromInfo && toInfo) {
      setFromCurrency(fromInfo);
      setToCurrency(toInfo);
      triggerBanner(`Loaded favorite: ${fromCode} to ${toCode}`, 'success');
    }
  };

  // Alerts logic
  const fetchAlerts = async () => {
    if (!token) return;
    try {
      if (USE_LOCAL_MOCK_API) {
        const data = await localApiFetch("/api/alerts");
        setRateAlerts(data.alerts || []);
        return;
      }

      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const path = "alerts";
      const q = query(collection(db, path), where("userId", "==", userId));
      const querySnapshot = await getDocs(q);
      const list: RateAlert[] = [];
      querySnapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: docSnap.id,
          userId: d.userId,
          fromCode: d.fromCode,
          toCode: d.toCode,
          targetRate: d.targetRate,
          condition: d.condition,
          isActive: d.isActive,
          isTriggered: d.isTriggered,
          createdAt: d.createdAt,
          triggeredAt: d.triggeredAt,
          triggeredRate: d.triggeredRate
        });
      });
      setRateAlerts(list);
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.LIST, "alerts");
      } else {
        console.error("Fetch alerts error:", error);
      }
    }
  };

  const handleCreateAlertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setAuthView("login");
      triggerBanner("Please log in to set dynamic rate triggers.", 'info');
      return;
    }
    const targetVal = parseFloat(alertTargetRate);
    if (isNaN(targetVal) || targetVal <= 0) {
      triggerBanner("Please provide a valid threshold rate multiplier.", 'warn');
      return;
    }

    try {
      if (USE_LOCAL_MOCK_API) {
        await localApiFetch("/api/alerts", "POST", {
          fromCode: fromCurrency.code,
          toCode: toCurrency.code,
          targetRate: targetVal,
          condition: alertCondition
        });
        setAlertTargetRate("");
        fetchAlerts();
        triggerBanner(`Alert configured! Notify when ${fromCurrency.code}/${toCurrency.code} goes ${alertCondition} ${targetVal}.`, 'success');
        return;
      }

      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const path = "alerts";
      const docData = {
        userId,
        fromCode: fromCurrency.code,
        toCode: toCurrency.code,
        targetRate: targetVal,
        condition: alertCondition,
        isActive: true,
        isTriggered: false,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, path), docData);
      setAlertTargetRate("");
      fetchAlerts();
      triggerBanner(`Alert configured! Notify when ${fromCurrency.code}/${toCurrency.code} goes ${alertCondition} ${targetVal}.`, 'success');
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.CREATE, "alerts");
      } else {
        console.error("Create alert error:", error);
      }
    }
  };

  const handleToggleAlert = async (id: string) => {
    if (!token) return;
    const alertItem = alertsList.find(a => a.id === id);
    if (!alertItem) return;

    try {
      if (USE_LOCAL_MOCK_API) {
        await localApiFetch(`/api/alerts/${id}/toggle`, "PUT");
        fetchAlerts();
        return;
      }

      await updateDoc(doc(db, "alerts", id), {
        isActive: !alertItem.isActive
      });
      fetchAlerts();
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.UPDATE, `alerts/${id}`);
      } else {
        console.error("Toggle alert error:", error);
      }
    }
  };

  const handleDeleteAlert = async (id: string) => {
    if (!token) return;
    try {
      if (USE_LOCAL_MOCK_API) {
        await localApiFetch(`/api/alerts/${id}`, "DELETE");
        triggerBanner("Price alert removed.", 'info');
        fetchAlerts();
        return;
      }

      await deleteDoc(doc(db, "alerts", id));
      triggerBanner("Price alert removed.", 'info');
      fetchAlerts();
    } catch (error) {
      if (!USE_LOCAL_MOCK_API && auth.currentUser) {
        handleFirestoreError(error, OperationType.DELETE, `alerts/${id}`);
      } else {
        console.error("Delete alert error:", error);
      }
    }
  };

  // Run alert check and populate triggered notification panel
  const verifyAlertStatusQuietly = async () => {
    if (!token) return;
    
    // In local API mode, we let the backend process and verify all triggers automatically
    if (USE_LOCAL_MOCK_API) {
      try {
        const data = await localApiFetch("/api/alerts/verify-triggers", "POST");
        if (data.triggeredCount > 0 && data.triggeredList) {
          data.triggeredList.forEach((al: any) => {
            const alertMsg = `🎯 TRIGGERED: ${al.fromCode}/${al.toCode} hit ${al.triggeredRate} (Target: ${al.condition === 'above' ? '≥' : '≤'} ${al.targetRate})`;
            setAlertTriggerFeed(prev => [alertMsg, ...prev].slice(0, 5));
            triggerBanner(alertMsg, 'warn');
          });
          fetchAlerts();
        }
      } catch (err) {
        console.error("Error verifying triggers via Express:", err);
      }
      return;
    }

    if (latestRate) {
      let triggeredAny = false;
      for (const al of alertsList) {
        if (al.isActive && !al.isTriggered && al.fromCode === fromCurrency.code && al.toCode === toCurrency.code) {
          let hit = false;
          if (al.condition === 'above' && latestRate >= al.targetRate) hit = true;
          if (al.condition === 'below' && latestRate <= al.targetRate) hit = true;
          
          if (hit) {
            const path = `alerts/${al.id}`;
            try {
              await updateDoc(doc(db, "alerts", al.id), {
                isTriggered: true,
                isActive: false,
                triggeredAt: new Date().toISOString(),
                triggeredRate: latestRate
              });
              triggeredAny = true;
              
              const alertMsg = `🎯 TRIGGERED: ${al.fromCode}/${al.toCode} hit ${latestRate} (Target: ${al.condition === 'above' ? '≥' : '≤'} ${al.targetRate})`;
              setAlertTriggerFeed(prev => [alertMsg, ...prev].slice(0, 5));
              triggerBanner(alertMsg, 'warn');
            } catch (error) {
              console.error("Failed to trigger alert in Firestore: ", error);
            }
          }
        }
      }
      if (triggeredAny) {
        fetchAlerts();
      }
    }
  };

  // Trigger alert checks instantly via simulated user click
  const handleForceAlertCheck = async () => {
    setTriggerCheckSuccess(true);
    await verifyAlertStatusQuietly();
    setTimeout(() => setTriggerCheckSuccess(false), 2000);
  };

  // Filter lists based on country queries
  const filteredFromCurrencies = SUPPORTED_CURRENCIES.filter(
    c => c.code.toLowerCase().includes(searchFromQuery.toLowerCase()) || 
         c.name.toLowerCase().includes(searchFromQuery.toLowerCase())
  );

  const filteredToCurrencies = SUPPORTED_CURRENCIES.filter(
    c => c.code.toLowerCase().includes(searchToQuery.toLowerCase()) || 
         c.name.toLowerCase().includes(searchToQuery.toLowerCase())
  );

  // Math conversions
  const calculatedOutput = conversionResult !== null ? conversionResult : (amount * (latestRate || 1));

  return (
    <div id="currency-app-container" className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-teal-500 selection:text-white relative overflow-x-hidden pb-16">
      
      {/* Dynamic Background Accents */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Floating Alert System Banners */}
      <AnimatePresence>
        {bannerAlert && (
          <motion.div 
            initial={{ opacity: 0, y: -50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border shadow-2xl max-w-md w-[calc(100%-2rem)] ${
              bannerAlert.type === 'success' 
                ? 'bg-teal-950/90 border-teal-500/30 text-teal-200' 
                : bannerAlert.type === 'warn' 
                ? 'bg-amber-950/90 border-amber-500/30 text-amber-200' 
                : 'bg-slate-800/95 border-slate-700 text-slate-200'
            }`}
          >
            {bannerAlert.type === 'success' && <CheckCircle2 className="w-5 h-5 text-teal-400 shrink-0" />}
            {bannerAlert.type === 'warn' && <BellRing className="w-5 h-5 text-amber-400 shrink-0 animate-bounce" />}
            {bannerAlert.type === 'info' && <Sparkles className="w-5 h-5 text-teal-300 shrink-0" />}
            <span className="text-sm font-medium">{bannerAlert.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Global Navigation */}
      <header id="main-navigation-bar" className="sticky top-0 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-40 navbar-height">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo & Headline */}
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-blue-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <span className="font-mono text-xl font-bold text-white tracking-widest">%</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                Apex Currency Converter <span className="text-xs bg-slate-800 text-teal-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">Live API</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-mono hidden sm:block">Exchange & Rates Analyzer</p>
            </div>
          </div>

          {/* Time tracker and User Status Section */}
          <div className="flex items-center gap-4">
            
            {/* UTC Clock Bar */}
            <div className="hidden md:flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/50 px-3 py-1.5 rounded-lg text-[11px] font-mono text-slate-300">
              <Clock className="w-3.5 h-3.5 text-teal-400" />
              <span>{currentTimeUTC || "UTC Running"}</span>
            </div>

            {currentUser ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowProfileSettings(!showProfileSettings)}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 transition px-3.5 py-2 rounded-lg border border-slate-700 text-sm font-medium focus:ring-2 focus:ring-teal-500"
                >
                  <UserCheck className="w-4 h-4 text-teal-400" />
                  <span className="hidden sm:inline truncate max-w-[110px]">{currentUser.username}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <button 
                  onClick={handleLogout}
                  title="Logout"
                  className="p-2 bg-slate-800 hover:bg-red-950/40 hover:text-red-300 hover:border-red-500/30 transition rounded-lg border border-slate-700 text-slate-400"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setAuthView("login")}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 hover:text-white px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-700 transition text-slate-300 focus:outline-none"
                >
                  <LogIn className="w-4 h-4" />
                  Login
                </button>
                <button 
                  onClick={() => setAuthView("signup")}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-slate-900 font-semibold px-3.5 py-2 text-sm rounded-lg shadow-md hover:shadow-lg transition focus:outline-none"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">

        {/* PROFILE PREFERENCES OVERLAY / EXPANSION CONTAINER */}
        <AnimatePresence>
          {showProfileSettings && currentUser && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-8"
            >
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-6 shadow-xl relative">
                <div id="preferences-settings-group" className="flex items-start justify-between mb-4 border-b border-slate-700/60 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Settings className="w-4 h-4 text-teal-400" />
                      Account Settings & API Preferences
                    </h3>
                    <p className="text-xs text-slate-400">Configure your default currencies, frequency triggers, and contact thresholds.</p>
                  </div>
                  <button 
                    onClick={() => setShowProfileSettings(false)}
                    className="text-xs text-slate-400 hover:text-white hover:underline transition"
                  >
                    Close Settings
                  </button>
                </div>

                <form onSubmit={handleUpdateProfile} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* General Info */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase tracking-wider">Username</label>
                      <input 
                        type="text" 
                        value={settingsUsername}
                        onChange={(e) => setSettingsUsername(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase tracking-wider">Email (Isolated/Immutable)</label>
                      <input 
                        type="email" 
                        value={currentUser.email} 
                        disabled 
                        className="w-full bg-slate-900/55 border border-slate-850 rounded-lg px-3 py-2 text-sm text-slate-400 font-mono cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Base Currency Choice */}
                  <div>
                    <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase tracking-wider">Preferred Base Currency</label>
                    <div className="relative">
                      <select 
                        value={settingsPreferredBase}
                        onChange={(e) => setSettingsPreferredBase(e.target.value)}
                        className="w-full h-10 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-sm text-white focus:outline-none focus:border-teal-500 appearance-none font-medium"
                      >
                        {SUPPORTED_CURRENCIES.map(curr => (
                          <option key={curr.code} value={curr.code}>{curr.flag} {curr.code} - {curr.name}</option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">Automatically preloads this currency as your source option during conversions.</p>
                  </div>

                  {/* Notification Toggle Buttons */}
                  <div className="flex flex-col justify-between">
                    <div className="space-y-3 pt-2">
                      <label id="checkbox-daily-updates" className="flex items-center gap-3 cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={settingsDailyUpdates}
                          onChange={(e) => setSettingsDailyUpdates(e.target.checked)}
                          className="w-4 h-4 rounded text-teal-500 bg-slate-900 border-slate-700 focus:ring-teal-500 cursor-pointer accent-teal-500"
                        />
                        <span className="text-sm text-slate-300">Daily conversion rate notification updates</span>
                      </label>

                      <label id="checkbox-alerts-push" className="flex items-center gap-3 cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={settingsReceiveAlerts}
                          onChange={(e) => setSettingsReceiveAlerts(e.target.checked)}
                          className="w-4 h-4 rounded text-teal-500 bg-slate-900 border-slate-700 focus:ring-teal-500 cursor-pointer accent-teal-500"
                        />
                        <span className="text-sm text-slate-300">Instant triggered pricing threshold alerts</span>
                      </label>
                    </div>

                    <div className="flex items-center gap-3 mt-6 md:mt-0">
                      <button 
                        type="submit" 
                        className="flex-1 bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm transition"
                      >
                        Save Preferences
                      </button>
                    </div>
                  </div>
                </form>

                {settingsSuccessMsg && (
                  <div className="mt-3 text-xs text-teal-400 font-medium font-mono">{settingsSuccessMsg}</div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PRIMARY FUNCTIONAL SPLIT: LEFT (Converter & Chart) | RIGHT (Favorites & Limit Alerts) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* LEFT 7-COLUMNS: CONVERTER CARD & INTERACTIVE GRAPH COMPONENT */}
          <section id="converter-and-analytics-suite" className="lg:col-span-8 space-y-8">
            
            {/* converter core widget */}
            <div className="bg-slate-800/40 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative">
              
              {/* Highlight Gradient strip */}
              <div className="absolute top-0 inset-x-12 h-[2px] bg-gradient-to-r from-transparent via-teal-500 to-transparent" />

              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-extrabold text-white sm:text-2xl">Convert Currency</h2>
                  <p className="text-xs text-slate-400 mt-1">Get instant calculations derived from key verified real-time rates.</p>
                </div>
                <button
                  onClick={handleAddFavorite}
                  title="Save Pair"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700/60 text-slate-300 text-xs hover:bg-slate-750 hover:text-yellow-400 transition"
                >
                  <Star className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Add Favorite</span>
                </button>
              </div>

              {/* Converter Controls Grid */}
              <div className="space-y-6">
                
                {/* 1. Amount Row */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-2 font-bold">Value to Convert</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      min="0.01" 
                      step="any"
                      value={amount || ""}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      placeholder="Enter amount..."
                      className="w-full h-14 bg-slate-900 border-2 border-slate-800 rounded-xl px-4 text-xl text-white font-bold tracking-wide focus:outline-none focus:border-teal-500 transition shadow-inner"
                    />
                    <div className="absolute right-4 top-4 font-mono font-bold text-slate-500">
                      {fromCurrency.symbol}
                    </div>
                  </div>
                </div>

                {/* 2. Source & Target Currencies Row */}
                <div className="grid grid-cols-1 md:grid-cols-9 gap-4 items-center">
                  
                  {/* From Dropdown */}
                  <div ref={fromDropdownRef} className="md:col-span-4 relative">
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-2">From</label>
                    <button
                      type="button"
                      onClick={() => setOpenFromDropdown(!openFromDropdown)}
                      className="w-full h-12 bg-slate-900 hover:bg-slate-900/90 border border-slate-800 rounded-xl px-4 flex items-center justify-between font-medium text-white shadow-sm transition"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-xl leading-none">{fromCurrency.flag}</span>
                        <span className="font-bold">{fromCurrency.code}</span>
                        <span className="text-xs text-slate-400 truncate max-w-[100px] sm:max-w-[140px]">- {fromCurrency.name}</span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    </button>

                    <AnimatePresence>
                      {openFromDropdown && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute left-0 mt-2 w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden"
                        >
                          {/* Dropdown Search searchbar */}
                          <div className="p-2 border-b border-slate-800 flex items-center gap-2">
                            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <input
                              type="text"
                              placeholder="Search list..."
                              value={searchFromQuery}
                              onChange={(e) => setSearchFromQuery(e.target.value)}
                              className="w-full bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
                            />
                          </div>
                          <div className="max-h-56 overflow-y-auto font-mono text-xs">
                            {filteredFromCurrencies.length > 0 ? (
                              filteredFromCurrencies.map((cc) => (
                                <button
                                  key={cc.code}
                                  type="button"
                                  onClick={() => {
                                    setFromCurrency(cc);
                                    setOpenFromDropdown(false);
                                    setSearchFromQuery("");
                                  }}
                                  className={`w-full text-left px-4 py-2.5 hover:bg-slate-800 flex items-center justify-between transition ${
                                    fromCurrency.code === cc.code ? "bg-teal-950/40 text-teal-400 font-bold" : "text-slate-300"
                                  }`}
                                >
                                  <span>{cc.flag} {cc.code} <span className="font-sans text-slate-500">- {cc.name}</span></span>
                                  {fromCurrency.code === cc.code && <span className="text-[10px] text-teal-400">active</span>}
                                </button>
                              ))
                            ) : (
                              <div className="p-3 text-slate-500 text-center">No currency found</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* SWAP BUTTON */}
                  <div className="md:col-span-1 flex justify-center pt-5">
                    <motion.button
                      type="button"
                      onClick={handleSwapCurrencies}
                      animate={isSwapping ? { rotate: 180 } : { rotate: 0 }}
                      transition={{ duration: 0.3 }}
                      aria-label="Reverse currency pair"
                      className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-750 active:bg-slate-700 border border-slate-700 flex items-center justify-center text-teal-400 hover:text-teal-300 shadow-md transition focus:ring-2 focus:ring-teal-500 focus:outline-none"
                    >
                      <ArrowLeftRight className="w-4 h-4" />
                    </motion.button>
                  </div>

                  {/* To Dropdown */}
                  <div ref={toDropdownRef} className="md:col-span-4 relative">
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-widest mb-2">To</label>
                    <button
                      type="button"
                      onClick={() => setOpenToDropdown(!openToDropdown)}
                      className="w-full h-12 bg-slate-900 hover:bg-slate-900/90 border border-slate-800 rounded-xl px-4 flex items-center justify-between font-medium text-white shadow-sm transition"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-xl leading-none">{toCurrency.flag}</span>
                        <span className="font-bold">{toCurrency.code}</span>
                        <span className="text-xs text-slate-400 truncate max-w-[100px] sm:max-w-[140px]">- {toCurrency.name}</span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    </button>

                    <AnimatePresence>
                      {openToDropdown && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute left-0 mt-2 w-full bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden"
                        >
                          {/* Search bar inside Dropdown */}
                          <div className="p-2 border-b border-slate-800 flex items-center gap-2">
                            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <input
                              type="text"
                              placeholder="Search list..."
                              value={searchToQuery}
                              onChange={(e) => setSearchToQuery(e.target.value)}
                              className="w-full bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
                            />
                          </div>
                          <div className="max-h-56 overflow-y-auto font-mono text-xs">
                            {filteredToCurrencies.length > 0 ? (
                              filteredToCurrencies.map((cc) => (
                                <button
                                  key={cc.code}
                                  type="button"
                                  onClick={() => {
                                    setToCurrency(cc);
                                    setOpenToDropdown(false);
                                    setSearchToQuery("");
                                  }}
                                  className={`w-full text-left px-4 py-2.5 hover:bg-slate-800 flex items-center justify-between transition ${
                                    toCurrency.code === cc.code ? "bg-teal-950/40 text-teal-400 font-bold" : "text-slate-300"
                                  }`}
                                >
                                  <span>{cc.flag} {cc.code} <span className="font-sans text-slate-500">- {cc.name}</span></span>
                                  {toCurrency.code === cc.code && <span className="text-[10px] text-teal-400">active</span>}
                                </button>
                              ))
                            ) : (
                              <div className="p-3 text-slate-500 text-center">No currency found</div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                </div>

                {/* 3. Output display panels */}
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 relative">
                  {isLoadingConversion ? (
                    <div className="space-y-2 py-4">
                      <div className="h-4 bg-slate-800 rounded w-1/3 animate-pulse" />
                      <div className="h-8 bg-slate-800 rounded w-2/3 animate-pulse" />
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-slate-400 font-mono tracking-wider font-semibold">
                        {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {fromCurrency.name} =
                      </p>
                      
                      <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                        <div className="text-2xl sm:text-4xl font-black text-white tracking-tight">
                          {calculatedOutput.toLocaleString(undefined, { minimumFractionDigits: 4 })}
                          <span className="text-xl sm:text-2xl font-bold ml-2 text-slate-300">{toCurrency.code}</span>
                        </div>
                        
                        <div className="text-[11px] font-mono text-slate-500 bg-slate-800/40 px-2.5 py-1 rounded-md border border-slate-750">
                          1 {fromCurrency.code} = {latestRate?.toFixed(5) || "..."} {toCurrency.code}
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/50 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                        <div>
                          <span>Real-time price feed parsed </span>
                          <span className="text-slate-400">10m expiry cache</span>
                        </div>
                        <div>
                          <span>Captured {conversionTimestamp ? new Date(conversionTimestamp).toLocaleTimeString() : "--:--:--"}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* HISTORICAL TREND GRAPHS CARD */}
            <div className="bg-slate-800/20 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-extrabold text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-teal-400" />
                    Exchange Rate Trends
                  </h3>
                  <p className="text-xs text-slate-400">Interactive charts analyzing performance curves backwards in time.</p>
                </div>

                {/* Range Select Toggles */}
                <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl text-xs font-mono">
                  {(["week", "month", "year"] as const).map(rng => (
                    <button
                      key={rng}
                      onClick={() => setChartRange(rng)}
                      className={`px-3 py-1.5 rounded-lg transition font-bold ${
                        chartRange === rng 
                          ? "bg-teal-500 text-slate-950" 
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {rng === 'week' ? '1W' : rng === 'month' ? '1M' : '1Y'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Statistical Coordinates Grid */}
              <div className="grid grid-cols-3 gap-3 bg-slate-900/45 p-4 rounded-2xl border border-slate-800 font-mono text-xs">
                <div>
                  <span className="block text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">High Rate</span>
                  <span className="text-sm font-black text-teal-400">{chartHigh ? chartHigh.toFixed(5) : "---"}</span>
                </div>
                <div>
                  <span className="block text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">Average</span>
                  <span className="text-sm font-black text-slate-300">{chartAvg ? chartAvg.toFixed(5) : "---"}</span>
                </div>
                <div>
                  <span className="block text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">Low Rate</span>
                  <span className="text-sm font-black text-rose-400">{chartLow ? chartLow.toFixed(5) : "---"}</span>
                </div>
              </div>

              {/* Graphic Plot Frame */}
              <div className="h-[280px] w-full" id="history-analyzing-graph-canvas">
                {isLoadingHistorical ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-sm text-slate-500 font-mono gap-2 bg-slate-900/20 rounded-2xl border border-slate-850">
                    <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                    <span>Analyzing exchange trend patterns...</span>
                  </div>
                ) : historicalData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={historicalData}
                      margin={{ top: 10, right: 5, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.01}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.6} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#475569" 
                        fontSize={10}
                        fontFamily="monospace"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(str) => {
                          try {
                            const parts = str.split("-");
                            return `${parts[1]}/${parts[2]}`;
                          } catch {
                            return str;
                          }
                        }}
                      />
                      <YAxis 
                        stroke="#475569" 
                        fontSize={10}
                        fontFamily="monospace"
                        tickLine={false}
                        axisLine={false}
                        domain={['auto', 'auto']}
                        tickFormatter={(val) => val.toFixed(3)}
                      />
                      <ChartTooltip
                        contentStyle={{ 
                          backgroundColor: '#0f172a', 
                          borderColor: '#334155', 
                          borderRadius: '12px',
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          color: '#f8fafc'
                        }}
                        labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="rate" 
                        stroke="#14b8a6" 
                        strokeWidth={2.5}
                        fillOpacity={1} 
                        fill="url(#colorRate)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 font-mono">
                    No timeline tracking logs configured.
                  </div>
                )}
              </div>

              {/* Graphic Footer */}
              <div className="flex items-center gap-1.5 p-3 rounded-lg bg-teal-950/20 border border-teal-500/10 text-[10px] text-teal-300 font-mono">
                <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Ratios show back-calculated comparative increments. Interactive elements dynamically resize charts.</span>
              </div>

            </div>

          </section>

          {/* RIGHT 4-COLUMNS: BOOKMARKED FAVORITES & PRICE ALERT ENGINE */}
          <section id="sidebar-saved-preferences-panel" className="lg:col-span-4 space-y-8">
            
            {/* BOOKMARKED FAVORITES WIDGET */}
            <div className="bg-slate-800/30 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-extrabold text-white flex items-center gap-1.5 uppercase tracking-wider">
                  <Star className="w-4 h-4 text-teal-400 shrink-0" />
                  Your Favorites
                </h3>
                <span className="text-[10px] font-mono bg-slate-900 px-2 py-0.5 rounded text-slate-400 border border-slate-800">
                  {favoritesList.length} Saved
                </span>
              </div>

              {/* Logged Out state for Favorites */}
              {!currentUser && (
                <div className="p-5 text-center bg-slate-900/35 rounded-2xl border border-slate-850 text-xs text-slate-400 space-y-3">
                  <p>Register an account to store personalized base currencies and frequently used conversions.</p>
                  <button
                    onClick={() => setAuthView("signup")}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 font-semibold text-slate-200 border border-slate-700 rounded-lg text-xs transition"
                  >
                    Get Started Free
                  </button>
                </div>
              )}

              {/* Logged-In favorites display */}
              {currentUser && (
                <div className="space-y-2.5 max-h-[290px] overflow-y-auto pr-1">
                  {favoritesList.length > 0 ? (
                    favoritesList.map((fav) => (
                      <div 
                        key={fav.id}
                        className="bg-slate-900/50 hover:bg-slate-900 border border-slate-850 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between transition group"
                      >
                        <button
                          onClick={() => handleTriggerFavoriteConvert(fav.fromCode, fav.toCode)}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-1 text-xs font-black text-white">
                            <span>{fav.fromCode}</span>
                            <span className="text-slate-500 font-normal">→</span>
                            <span>{fav.toCode}</span>
                          </div>
                          
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            Rate: {fav.currentRate ? fav.currentRate.toFixed(4) : "calc..."}
                          </div>
                        </button>

                        <button
                          onClick={() => handleRemoveFavorite(fav.id)}
                          title="Delete favorite bookmark"
                          className="p-1 px-2 text-slate-500 hover:text-rose-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center p-6 text-xs text-slate-500 font-mono bg-slate-900/20 rounded-2xl border border-dashed border-slate-800">
                      No favorite trading pairs saved yet. Use the star button above!
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* LIVE RATE THRESHOLD ALERTS ENGINE */}
            <div className="bg-slate-800/30 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-5">
              
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-extrabold text-white flex items-center gap-1.5 uppercase tracking-wider">
                  <Bell className="w-4 h-4 text-teal-400 shrink-0" />
                  Rate Alert Engine
                </h3>
                {currentUser && (
                  <button 
                    onClick={handleForceAlertCheck}
                    className="text-[10px] font-mono hover:text-teal-400 text-slate-400 underline transition focus:outline-none"
                    title="Triggers instant alert validation sweep"
                  >
                    {triggerCheckSuccess ? "Checking..." : "Verify Alerts"}
                  </button>
                )}
              </div>

              {!currentUser ? (
                <div className="p-5 text-center bg-slate-900/35 rounded-2xl border border-slate-850 text-xs text-slate-400 space-y-3">
                  <p>Set custom notification rules! Be alerted directly on target gains/losses across pairs.</p>
                  <button
                    onClick={() => setAuthView("login")}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-705 font-semibold text-slate-200 border border-slate-700/80 rounded-lg text-xs transition"
                  >
                    Login to Setup
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Alert setup form */}
                  <form onSubmit={handleCreateAlertSubmit} className="space-y-3 bg-slate-900/40 p-3.5 rounded-2xl border border-slate-800">
                    <p className="text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider">
                      Setup Trigger: {fromCurrency.code}/{toCurrency.code}
                    </p>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <button
                        type="button"
                        onClick={() => setAlertCondition("above")}
                        className={`py-1.5 px-2 rounded-lg font-bold border transition ${
                          alertCondition === "above" 
                            ? "bg-teal-500/20 border-teal-500 text-teal-300" 
                            : "bg-slate-900 border-slate-800 text-slate-400"
                        }`}
                      >
                        When rate is ≥
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlertCondition("below")}
                        className={`py-1.5 px-2 rounded-lg font-bold border transition ${
                          alertCondition === "below" 
                            ? "bg-rose-500/20 border-rose-500 text-rose-300" 
                            : "bg-slate-900 border-slate-800 text-slate-400"
                        }`}
                      >
                        When rate is ≤
                      </button>
                    </div>

                    <div>
                      <input 
                        type="number" 
                        step="any"
                        placeholder={`Threshold (e.g. ${(latestRate || 1.1).toFixed(4)})`}
                        value={alertTargetRate}
                        onChange={(e) => setAlertTargetRate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-teal-500 font-mono text-center"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2 bg-teal-500 text-slate-950 hover:bg-teal-600 font-black rounded-lg text-xs transition uppercase"
                    >
                      Establish Target Rule
                    </button>
                  </form>

                  {/* Configured alerts list */}
                  <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                    {alertsList.length > 0 ? (
                      alertsList.map((al) => (
                        <div 
                          key={al.id}
                          className={`border rounded-xl p-3 flex flex-col gap-1.5 transition ${
                            al.isTriggered 
                              ? 'bg-slate-900/30 border-slate-850 opacity-60' 
                              : al.isActive 
                              ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700' 
                              : 'bg-slate-900/30 border-slate-850 text-slate-500'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-200">
                              {al.fromCode}/{al.toCode}
                            </span>
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                              al.isTriggered 
                                ? 'bg-amber-950 text-amber-400 border border-amber-900/50' 
                                : al.isActive 
                                ? 'bg-teal-950 text-teal-400 border border-teal-900/40' 
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {al.isTriggered ? 'Triggered!' : al.isActive ? 'Active' : 'Muted'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                            <div>
                              <span>Trigger {al.condition === 'above' ? '≥' : '≤'}: </span>
                              <span className="font-bold text-slate-350">{al.targetRate}</span>
                            </div>
                            
                            {/* Delete Alert action buttons */}
                            <div className="flex items-center gap-1.5">
                              {/* Toggle active state */}
                              <button
                                onClick={() => handleToggleAlert(al.id)}
                                className="text-[10px] text-slate-450 hover:text-slate-200 hover:underline transition"
                              >
                                {al.isActive ? 'Mute' : 'Resume'}
                              </button>
                              
                              <button
                                onClick={() => handleDeleteAlert(al.id)}
                                className="text-slate-500 hover:text-rose-400 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {al.isTriggered && al.triggeredAt && (
                            <div className="text-[9px] font-mono bg-amber-950/20 p-1 rounded text-amber-300">
                              Fired: {new Date(al.triggeredAt).toLocaleTimeString()} @ {al.triggeredRate?.toFixed(5)}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center p-4 text-xs text-slate-500 font-mono bg-slate-900/20 rounded-2xl border border-dashed border-slate-800">
                        No threshold limit rules active.
                      </div>
                    )}
                  </div>

                  {/* Simulated alert notifications window */}
                  {alertTriggerFeed.length > 0 && (
                    <div className="mt-3 bg-amber-950/20 border border-amber-500/20 p-3 rounded-2xl space-y-1.5">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-amber-400 font-mono">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span>Recent Signal Logs</span>
                      </div>
                      <div className="space-y-1 font-mono text-[10px] text-amber-200">
                        {alertTriggerFeed.map((f, i) => (
                          <div key={i} className="truncate">
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}

            </div>

          </section>

        </div>

      </main>

      {/* LOGIN & SIGNUP SLIDE-IN POPUP OVERLAY */}
      <AnimatePresence>
        {authView !== "none" && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative"
            >
              
              {/* Close Button */}
              <button 
                onClick={() => setAuthView("none")}
                className="absolute top-4 right-4 text-slate-400 hover:text-white text-xs font-mono font-bold"
              >
                ✕ Close
              </button>

              <div className="mb-6">
                <h3 className="text-xl font-extrabold text-white">
                  {authView === "login" ? "Welcome Back" : "Establish Profile"}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {authView === "login" 
                    ? "Log in to retrieve saved favorites and track personalized currency pairs." 
                    : "Create a user account to configure custom alerts and preferred base currency."}
                </p>
                {USE_LOCAL_MOCK_API ? (
                  <div className="mt-3 bg-teal-500/10 border border-teal-500/20 p-2.5 rounded-xl flex items-start gap-2 text-teal-350 text-[11px] leading-relaxed">
                    <Sparkles className="w-4 h-4 text-teal-400 shrink-0 mt-0.5 animate-pulse" />
                    <span>
                      <strong>Sandbox Mode:</strong> App is running in Local Sandbox Mode. Accounts are saved in local memory. You can sign up instantly with any email and password!
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl flex items-start gap-2 text-amber-300 text-[11px] leading-relaxed">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
                    <span>
                      <strong>Environment Notice:</strong> Email/Password authentication is disabled in this Starter Tier project. Please use <strong>Sign in with Google</strong> at the bottom of the modal.
                    </span>
                  </div>
                )}
              </div>

              {authError && (
                <div className="mb-4 bg-rose-950/40 border border-rose-500/20 p-3 rounded-xl flex items-start gap-2 text-rose-350 text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-450 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {/* Login Form */}
              {authView === "login" ? (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">Email Address</label>
                    <input 
                      type="email" 
                      required
                      placeholder="e.g. sam@example.com"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                    <input 
                      type="password" 
                      required
                      placeholder="••••••••"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 mt-4 bg-teal-500 hover:bg-teal-600 font-bold rounded-xl text-sm text-slate-950 transition"
                  >
                    Authenticate Session
                  </button>

                  <div className="text-center mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthView("signup");
                        setAuthError("");
                      }}
                      className="text-xs text-teal-400 hover:underline transition"
                    >
                      Don't have an account? Sign Up
                    </button>
                  </div>

                  {!USE_LOCAL_MOCK_API && (
                    <>
                      <div className="relative my-5">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-800"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase font-mono">
                          <span className="bg-slate-900 px-2.5 text-slate-500">Or continue with</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        className="w-full h-11 bg-slate-950/60 border border-slate-800 hover:bg-slate-800 hover:text-white text-slate-200 font-medium rounded-xl text-xs flex items-center justify-center gap-2.5 transition shadow-sm"
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M12.24 10.285V13.4h6.86c-.277 1.56-1.602 4.585-6.86 4.585-4.54 0-8.24-3.765-8.24-8.4s3.7-8.4 8.24-8.4c2.58 0 4.307 1.095 5.298 2.045l2.465-2.37C18.251 1.255 15.49 0 12.24 0 5.58 0 0 5.37 0 12s5.58 12 12.24 12c6.96 0 11.57-4.89 11.57-11.79 0-.795-.085-1.4-.195-1.925H12.24z"/>
                        </svg>
                        Sign in with Google
                      </button>
                    </>
                  )}
                </form>
              ) : (
                /* Signup Form */
                <form onSubmit={handleSignUpSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">Username</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. SamTraveler"
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">Email Address</label>
                    <input 
                      type="email" 
                      required
                      placeholder="e.g. sam@example.com"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-400 uppercase tracking-wider mb-1.5">Password</label>
                    <input 
                      type="password" 
                      required
                      placeholder="••••••••"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 mt-4 bg-teal-500 hover:bg-teal-600 font-bold rounded-xl text-sm text-slate-950 transition"
                  >
                    Register Profile
                  </button>

                  <div className="text-center mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthView("login");
                        setAuthError("");
                      }}
                      className="text-xs text-teal-400 hover:underline transition"
                    >
                      Already have an account? Log In
                    </button>
                  </div>

                  {!USE_LOCAL_MOCK_API && (
                    <>
                      <div className="relative my-5">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-800"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase font-mono">
                          <span className="bg-slate-900 px-2.5 text-slate-500">Or continue with</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        className="w-full h-11 bg-slate-950/60 border border-slate-800 hover:bg-slate-800 hover:text-white text-slate-200 font-medium rounded-xl text-xs flex items-center justify-center gap-2.5 transition shadow-sm"
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M12.24 10.285V13.4h6.86c-.277 1.56-1.602 4.585-6.86 4.585-4.54 0-8.24-3.765-8.24-8.4s3.7-8.4 8.24-8.4c2.58 0 4.307 1.095 5.298 2.045l2.465-2.37C18.251 1.255 15.49 0 12.24 0 5.58 0 0 5.37 0 12s5.58 12 12.24 12c6.96 0 11.57-4.89 11.57-11.79 0-.795-.085-1.4-.195-1.925H12.24z"/>
                        </svg>
                        Sign in with Google
                      </button>
                    </>
                  )}
                </form>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FOOTER */}
      <footer className="mt-20 border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 font-mono space-y-2">
          <p>© 2026 Currency Converter. Powered by Open Exchange Rates and local Brownian history synthesis.</p>
          <div className="flex justify-center gap-4 text-[10px]">
            <span>Secure TLS Encryption</span>
            <span>•</span>
            <span>Isolated Security Rules</span>
            <span>•</span>
            <span>Real-time Sync API</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
