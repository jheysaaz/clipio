import Header from "../components/Header";
import Search from "../components/Search";

interface DashboardProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export default function Dashboard({ theme, onToggleTheme }: DashboardProps) {
  return (
    <div>
      <Header title="Dashboard" theme={theme} onToggleTheme={onToggleTheme} />
      <Search />
    </div>
  );
}
