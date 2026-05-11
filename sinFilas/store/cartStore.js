import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useCartStore = create(
  persist(
    (set, get) => ({
      items: [],
      sessionId: null,
      
      addItem: (item) => set((state) => {
        // En "Sin Filas", si es un producto pesable (generó un GS1 dinámico o es KL), 
        // normalmente lo tratamos como un item nuevo o lo sumamos. 
        // Por simplicidad y como en retail un escaneo de báscula = una etiqueta impresa = un item
        // dejaremos que si el codigo_barras (GS1 exacto) es idéntico se sume, sino es línea nueva.
        const existing = state.items.find(i => i.codigo_barras === item.codigo_barras);
        
        if (existing && !item.requiere_peso) {
          // Solo sumamos cantidades para items no pesables (UND, PZ). 
          // Los pesables (KL) suelen ser registros únicos en la canasta física.
          return {
            items: state.items.map(i => 
              i.codigo_barras === item.codigo_barras 
                ? { ...i, cantidad: i.cantidad + (item.cantidad || 1) } 
                : i
            )
          };
        }
        
        // Si requiere peso, o no existe, lo agregamos como nueva línea
        return { items: [...state.items, { ...item, cantidad: item.cantidad || 1 }] };
      }),
      
      removeItem: (codigo) => set((state) => ({
        items: state.items.filter(i => i.codigo_barras !== codigo)
      })),
      
      clearCart: () => set({ items: [], sessionId: null }),
      
      setSession: (id) => set({ sessionId: id })
    }),
    {
      name: 'sf-cart-storage',
    }
  )
);
