// src/components/DragContext.tsx
import React, { createContext, useContext, useState } from 'react';

type DragContextType = {
  currentDraggedOutput: any | null;
  setCurrentDraggedOutput: (o: any | null) => void;
};

const DragContext = createContext<DragContextType>({
  currentDraggedOutput: null,
  setCurrentDraggedOutput: () => {},
});

export const DragProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentDraggedOutput, setCurrentDraggedOutput] = useState<any | null>(null);
  return (
    <DragContext.Provider value={{ currentDraggedOutput, setCurrentDraggedOutput }}>
      {children}
    </DragContext.Provider>
  );
};

export const useDrag = () => useContext(DragContext);
