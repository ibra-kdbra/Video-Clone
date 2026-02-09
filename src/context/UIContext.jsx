import { createContext, useContext, useState, useCallback } from 'react';

const UIContext = createContext();

export const UIProvider = ({ children }) => {
  const [selectedCategory, setSelectedCategory] = useState('New');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const setCategory = useCallback((category) => {
    setSelectedCategory(category);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  return (
    <UIContext.Provider value={{ selectedCategory, setCategory, sidebarOpen, toggleSidebar }}>
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
