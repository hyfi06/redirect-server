const botReject = require('../bot-reject.middleware');

describe('botReject', () => {
  let mockNext;
  let mockRes;

  beforeEach(() => {
    mockNext = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('.php extension', () => {
    it('returns 404 for /wp-login.php', () => {
      botReject({ path: '/wp-login.php' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /admin.php', () => {
      botReject({ path: '/admin.php' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /file.php', () => {
      botReject({ path: '/file.php' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('dotfile and hidden directory paths', () => {
    it('returns 404 for /.env', () => {
      botReject({ path: '/.env' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /.git', () => {
      botReject({ path: '/.git' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /.htaccess', () => {
      botReject({ path: '/.htaccess' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('WordPress paths', () => {
    it('returns 404 for /wp-admin/', () => {
      botReject({ path: '/wp-admin/' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /wp-includes/index.js', () => {
      botReject({ path: '/wp-includes/index.js' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /wp-content/upload.jpg', () => {
      botReject({ path: '/wp-content/upload.jpg' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('server-side script extensions', () => {
    it('returns 404 for /page.asp', () => {
      botReject({ path: '/page.asp' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /page.aspx', () => {
      botReject({ path: '/page.aspx' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /page.jsp', () => {
      botReject({ path: '/page.jsp' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /cgi-bin/test.cgi', () => {
      botReject({ path: '/cgi-bin/test.cgi' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('case-insensitive matching', () => {
    it('returns 404 for /admin.PHP (uppercase extension)', () => {
      botReject({ path: '/admin.PHP' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /admin.ASP (uppercase extension)', () => {
      botReject({ path: '/admin.ASP' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /WP-login (uppercase WordPress prefix)', () => {
      botReject({ path: '/WP-login' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 404 for /.ENV (uppercase dotfile)', () => {
      botReject({ path: '/.ENV' }, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('legitimate paths pass through', () => {
    it('calls next() for / (root)', () => {
      botReject({ path: '/' }, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('calls next() for /some/path (normal redirect)', () => {
      botReject({ path: '/some/path' }, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('calls next() for /api/v1/redirects', () => {
      botReject({ path: '/api/v1/redirects' }, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('calls next() for /about (contains "php" as substring, not as extension)', () => {
      botReject({ path: '/about' }, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('calls next() for /photographer (contains "wp" mid-word, not as /wp- prefix)', () => {
      botReject({ path: '/photographer' }, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
