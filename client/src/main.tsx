import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="light">
    <AuthProvider>
      <App />
    </AuthProvider>
  </ThemeProvider>
);
