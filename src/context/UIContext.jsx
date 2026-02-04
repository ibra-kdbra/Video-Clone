import { createContext, useContext, useState, useCallback } from 'react';

const UIContext = createContext();

export const UIProvider = ({ children }) => {
  const [selectedCategory, setSelectedCategory] = useState('New');

  const setCategory = useCallback((category) => {
    setSelectedCategory(category);
  }, []);

  return (
    <UIContext.Provider value={{ selectedCategory, setCategory }}>
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
