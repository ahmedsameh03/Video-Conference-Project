import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAWhddRJ14PwvggUv7doDWrZq_AQYTNHcc",
  authDomain: "smart-video-application.firebaseapp.com",
  projectId: "smart-video-application",
  storageBucket: "smart-video-application.appspot.com",
  messagingSenderId: "758851089586",
  appId: "1:758851089586:web:8c74989e54b71f75d285ab",
  measurementId: "G-GVXRFX9R1B",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Google Sign-In function
document.getElementById("google-login").addEventListener("click", () => {
  signInWithPopup(auth, provider)
    .then((result) => {
      console.log("User signed in:", result.user);
      window.location.href = "dashboard.html"; // Redirect to dashboard
    })
    .catch((error) => {
      console.error("Error during sign-in:", error);
      alert("Google Sign-In failed!");
    });
});
