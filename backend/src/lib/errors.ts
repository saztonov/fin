/** Ошибка уровня API: код HTTP + машинный код + сообщение для пользователя. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, code = 'bad_request') {
    return new ApiError(400, code, message);
  }
  static unauthorized(message = 'Требуется вход в систему', code = 'unauthorized') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'Недостаточно прав', code = 'forbidden') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Не найдено', code = 'not_found') {
    return new ApiError(404, code, message);
  }
  static conflict(message: string, code = 'conflict') {
    return new ApiError(409, code, message);
  }
}
