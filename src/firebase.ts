import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAwov-5O-bFJdSdRGEIENyOJLmWgH97Fm8",
  authDomain: "kira-85871.firebaseapp.com",
  projectId: "kira-85871",
  storageBucket: "kira-85871.firebasestorage.app",
  messagingSenderId: "172080094876",
  appId: "1:172080094876:web:2ba70c630f77ffc1499759",
  measurementId: "G-2YEQDJ7CVH",
};

export const app = initializeApp(firebaseConfig);

// Analytics only where supported, so the game never breaks if it is blocked.
isSupported().then((ok) => {
  if (ok) getAnalytics(app);
});
