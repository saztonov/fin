import { App } from 'antd';

/**
 * Единственная точка message/notification/modal (в AntD 6 статические
 * методы без контекста не получают тему и локаль).
 */
export function useFeedback() {
  const { message, notification, modal } = App.useApp();
  return { message, notification, modal };
}
