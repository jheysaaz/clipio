import { Code2, Sun, Moon } from "lucide-react";

interface HeaderProps {
  title?: string | "Snippet Manager";
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export default function Header({ title, theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="flex flex-row transition-colors">
      <div className="flex w-full justify-between items-start">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg">
              <Code2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-zinc-900 dark:text-zinc-50">{title}</h1>
          </div>
          <p className="text-zinc-600 dark:text-zinc-400">
            Store and manage your super snippets
          </p>
        </div>

        <button
          onClick={onToggleTheme}
          className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <Moon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
          ) : (
            <Sun className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
          )}
        </button>
      </div>
    </header>
  );
}
