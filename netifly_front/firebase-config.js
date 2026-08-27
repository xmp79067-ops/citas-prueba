import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrDlkC8tZ0evSpI9ZjwefoWe_uO3USbbo",
  authDomain: "maganguesoft-citas.firebaseapp.com",
  databaseURL: "https://maganguesoft-citas-default-rtdb.firebaseio.com",
  projectId: "maganguesoft-citas",
  storageBucket: "maganguesoft-citas.firebasestorage.app",
  messagingSenderId: "350352582980",
  appId: "1:350352582980:web:82e62a433855c40dcf0f11"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
export { db, ref, get };
