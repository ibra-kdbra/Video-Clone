import { createContext, useContext, useState, useCallback } from 'react';
import { PROVIDERS } from '../services/providers/types.js';

const UIContext = createContext();

export const UIProvider = ({ children }) => {
  const [selectedCategory, setSelectedCategory] = useState('New');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeProviders, setActiveProviders] = useState([PROVIDERS.YOUTUBE]);

  const setCategory = useCallback((category) => {
    setSelectedCategory(category);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const toggleProvider = useCallback((providerId) => {
    setActiveProviders((prev) => {
      if (prev.includes(providerId)) {
        // Don't allow deselecting all — at least one must remain
        if (prev.length === 1) return prev;
        return prev.filter((p) => p !== providerId);
      }
      return [...prev, providerId];
    });
  }, []);

  return (
    <UIContext.Provider value={{
      selectedCategory, setCategory,
      sidebarOpen, toggleSidebar,
      activeProviders, toggleProvider,
    }}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
};
