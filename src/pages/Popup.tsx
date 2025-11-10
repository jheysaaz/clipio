import Header from "../components/Header";
import Search from "../components/Search";
import { useTheme } from "../hooks/useTheme";

export default function Popup() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      <Header theme={theme} onToggleTheme={toggleTheme} />
      <Search />
    </div>
  );
}
