import { HardDrive, Cloud } from "lucide-react";
import { useNavigate } from "react-router";

interface LoginProps {
  theme: "light" | "dark";
  onSelectStorage: (type: "local" | "cloud") => void;
}

export default function Login({ theme, onSelectStorage }: LoginProps) {
  const navigate = useNavigate();

  const handleSelection = (type: "local" | "cloud") => {
    if (type === "local") {
      onSelectStorage(type);
      navigate("/dashboard");
    } else {
      // Redirect to cloud login page
      navigate("/cloud-login");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold mb-2">
          Welcome to Easy Snippets
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Choose how you want to store your snippets
        </p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        <button
          onClick={() => handleSelection("local")}
          className="group relative flex flex-col items-center gap-3 p-6 border-2 border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all"
        >
          <div className="p-3 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg group-hover:bg-blue-500/20 dark:group-hover:bg-blue-500/30 transition-colors">
            <HardDrive className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-center">
            <h3 className="font-medium text-lg mb-1">Local Storage</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Store snippets on this device only
            </p>
          </div>
        </button>

        <button
          onClick={() => handleSelection("cloud")}
          className="group relative flex flex-col items-center gap-3 p-6 border-2 border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-purple-500 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all"
        >
          <div className="p-3 bg-purple-500/10 dark:bg-purple-500/20 rounded-lg group-hover:bg-purple-500/20 dark:group-hover:bg-purple-500/30 transition-colors">
            <Cloud className="h-8 w-8 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="text-center">
            <h3 className="font-medium text-lg mb-1">Cloud Storage</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Sync snippets across all your devices
            </p>
          </div>
        </button>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-6 text-center">
        You can change this setting later in preferences
      </p>
    </div>
  );
}
