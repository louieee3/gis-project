// src/store/useStore.js
import { create } from 'zustand';
import { persist } from 'zustand/middleware'; // 导入 persist 中间件

const useStore = create(
  persist(
    (set) => ({
      // 1. 当前选中的地块数据
      selectedParcel: null,

      // 2. 动作：更新选中的地块
      setSelectedParcel: (parcelData) => set({ selectedParcel: parcelData }),

      // 3. 动作：清除选中
      clearSelection: () => set({ selectedParcel: null }),

      // 4. 新增：聊天历史记录
      chatHistory: [],

      // 5. 新增：将一次完整的对话存入历史
      addChatToHistory: (chat) =>
        set((state) => ({ chatHistory: [chat, ...state.chatHistory] })),

      // 6. 新增：一键清除所有历史记录
      clearChatHistory: () => set({ chatHistory: [] }),

      // 7. 新增：视图模式 ('analysis' 或 'timeseries')
      viewMode: 'analysis',
      setViewMode: (mode) => set({ viewMode: mode }),

      // 8. 新增：评价/预测叠层
      overlay: { visible: false, type: null, data: null },
      openOverlay: (payload) =>
        set({ overlay: { visible: true, type: payload.type, data: payload } }),
      closeOverlay: () => set({ overlay: { visible: false, type: null, data: null } }),
      updateOverlayData: (patch) =>
        set((state) => ({
          overlay: {
            ...state.overlay,
            data: { ...(state.overlay?.data || {}), ...(patch || {}) }
          }
        })),
      overlayPos: { x: null, y: null },
      setOverlayPos: (pos) => set({ overlayPos: pos }),

      // 9. 地块点击屏幕坐标（用于定位浮窗）
      clickPoint: null,
      setClickPoint: (pt) => set({ clickPoint: pt }),
    }),
    {
      name: 'gis-chat-history',
      partialize: (state) => ({ chatHistory: state.chatHistory }),
    }
  )
);

export default useStore;
