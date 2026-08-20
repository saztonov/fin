import type { ThemeConfig } from 'antd';

/**
 * Тема портала: лаконичный корпоративный стиль, один акцент geekblue,
 * нейтральная серо-голубая шкала. Только токены — hex в компонентах запрещён.
 */
export const appTheme: ThemeConfig = {
  cssVar: { key: 'ks' },
  hashed: false,
  token: {
    colorPrimary: '#2F54EB',
    colorInfo: '#2F54EB',
    colorLink: '#2F54EB',
    colorSuccess: '#389E0D',
    colorWarning: '#D48806',
    colorError: '#CF1322',

    colorBgLayout: '#F6F7F9',
    colorBgContainer: '#FFFFFF',
    colorBorder: '#D9DEE7',
    colorBorderSecondary: '#EBEEF3',
    colorText: '#1F2329',
    colorTextSecondary: '#5A6472',
    colorTextTertiary: '#8B94A3',

    borderRadius: 6,
    borderRadiusLG: 10,
    borderRadiusSM: 4,

    fontFamily:
      "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,

    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 44,

    motionDurationMid: '0.15s',
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      headerHeight: 56,
      headerPadding: '0 24px',
      bodyBg: '#F6F7F9',
      siderBg: '#FFFFFF',
    },
    Menu: {
      itemColor: '#5A6472',
      horizontalItemSelectedColor: '#2F54EB',
      activeBarHeight: 2,
      // вертикальное меню сайдбара
      itemSelectedColor: '#2F54EB',
      itemSelectedBg: '#EFF2FF',
      itemHoverBg: '#F4F6FB',
      itemBorderRadius: 6,
      itemMarginInline: 8,
      itemHeight: 40,
      iconSize: 16,
    },
    Table: {
      headerBg: '#FBFBFD',
      headerColor: '#5A6472',
      headerSplitColor: 'transparent',
      borderColor: '#EDF0F4',
      rowHoverBg: '#F4F6FB',
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
      cellFontSizeSM: 13,
      footerBg: '#FBFBFD',
    },
    Card: { borderRadiusLG: 12, paddingLG: 20 },
    Tabs: { titleFontSize: 14, horizontalItemGutter: 24 },
    Statistic: { titleFontSize: 13, contentFontSize: 26 },
    Tag: { defaultBg: '#F2F4F8', defaultColor: '#5A6472' },
    Modal: { borderRadiusLG: 12, titleFontSize: 16 },
    Drawer: { paddingLG: 24 },
  },
};
