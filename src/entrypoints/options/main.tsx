import React from "react";
import ReactDOM from "react-dom/client";
import "~/app.css";
import OptionsPage from "~/pages/OptionsPage";
import { ThemeProvider } from "~/hooks/ThemeContext";

function App() {
  return (
    <ThemeProvider>
      <OptionsPage />
    </ThemeProvider>
  );
}

const root = document.getElementById("root");

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
