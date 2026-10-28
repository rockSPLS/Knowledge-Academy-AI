"use client";

import { Search } from "lucide-react";
import { useSearch } from "./SearchProvider";

// Кнопка-лупа в шапке: открывает и закрывает панель поиска на любой странице
export function SearchToggle() {
  const { isOpen, toggle, toggleRef } = useSearch();
  return (
    <button
      ref={toggleRef}
      type="button"
      onClick={toggle}
      aria-expanded={isOpen}
      aria-controls="search-panel"
      aria-label="Поиск по материалам"
      title="Поиск по материалам"
      className={`rounded-md p-1.5 sm:p-2 transition-colors hover:bg-surface hover:text-foreground ${
        isOpen ? "bg-surface text-foreground" : "text-muted"
      }`}
    >
      <Search size={18} aria-hidden="true" />
    </button>
  );
}
