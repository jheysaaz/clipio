import { Search as SearchIcon } from "lucide-react";

export default function Search() {
  return (
    <div className="flex items-center gap-2 w-full p-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500">
      <SearchIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0" />
      <input
        type="text"
        placeholder="Search snippets..."
        className="flex-1 bg-transparent outline-none text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
      />
    </div>
  );
}
