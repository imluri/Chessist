// Chessist Overlay — C# / .NET 4.8 / GDI+
// Transparent click-through window, excluded from screen capture.
// WebSocket server on ws://127.0.0.1:27301
// Build:  dotnet build -c Release
//         output: overlay\bin\Release\net48\ChessistOverlay.exe

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ChessistOverlay
{
    // ── JSON data contracts ──────────────────────────────────────────────────────

    [DataContract] class EvalBarMsg
    {
        [DataMember(Name = "fillPercent")] public double FillPercent;
        [DataMember(Name = "isFlipped")]   public bool   IsFlipped;
        [DataMember(Name = "score")]       public string? Score;
    }

    [DataContract] class ArrowMsg
    {
        [DataMember(Name = "from")] public string? From;
        [DataMember(Name = "to")]   public string? To;
    }

    // JS sends raw viewport-relative CSS coords; C# resolves screen position via ClientToScreen.
    [DataContract] class WsMsg
    {
        [DataMember(Name = "visible")]      public bool        Visible;
        [DataMember(Name = "positionOnly")] public bool        PositionOnly;
        [DataMember(Name = "flipped")]      public bool        Flipped;
        [DataMember(Name = "viewX")]        public double      ViewX;
        [DataMember(Name = "viewY")]        public double      ViewY;
        [DataMember(Name = "width")]        public double      Width;
        [DataMember(Name = "height")]       public double      Height;
        [DataMember(Name = "dpr")]          public double      Dpr;
        [DataMember(Name = "evalBar")]      public EvalBarMsg?  EvalBar;
        [DataMember(Name = "arrows")]       public ArrowMsg[]?  Arrows;
    }

    // ── Win32 P/Invoke ────────────────────────────────────────────────────────────

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] struct POINT  { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct WSIZE  { public int W, H; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFO
    {
        public uint   biSize;
        public int    biWidth, biHeight;
        public ushort biPlanes, biBitCount;
        public uint   biCompression, biSizeImage;
        public int    biXPelsPerMeter, biYPelsPerMeter;
        public uint   biClrUsed, biClrImportant;
        public uint   bmiColors; // no color table for 32 bpp
    }

    // ── Overlay window ────────────────────────────────────────────────────────────

    sealed class OverlayForm : Form
    {
        const int  GWL_EXSTYLE        = -20;
        const int  WS_EX_LAYERED      = 0x00080000;
        const int  WS_EX_TRANSPARENT  = 0x00000020;
        const int  WS_EX_NOACTIVATE   = 0x08000000;
        const int  WS_EX_TOOLWINDOW   = 0x00000080;
        const uint WDA_EXCLUDEFROMCAPTURE  = 0x00000011;
        const uint ULW_ALPHA               = 2;
        const byte AC_SRC_OVER             = 0;
        const byte AC_SRC_ALPHA            = 1;
        [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref WSIZE psize, IntPtr hdcSrc, ref POINT pptSrc, uint crKey, ref BLENDFUNCTION pblend, uint dwFlags);
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
        [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint aff);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int n, int val);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int n);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder buf, int n);
        [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc fn, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("gdi32.dll")]  static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")]  static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);
        [DllImport("gdi32.dll")]  static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")]  static extern bool DeleteObject(IntPtr h);
        [DllImport("gdi32.dll")]  static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFO bi, uint usage, out IntPtr bits, IntPtr sec, uint off);
        [DllImport("kernel32.dll")] static extern void RtlMoveMemory(IntPtr dst, IntPtr src, int len);

        WsMsg? _state;
        System.Windows.Forms.Timer? _trackTimer;
        IntPtr _cachedRenderWnd;  // Chrome_RenderWidgetHostHWND — cached to avoid full EnumChildWindows each tick
        POINT  _lastOrigin;       // last ClientToScreen result — skip Blit if unchanged
        bool   _stateDirty;       // new WS message arrived — force repaint even if origin unchanged
        bool   _isBlank;          // true after Blank() so the 16ms timer doesn't re-blit a transparent frame

        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar   = false;
            TopMost         = true;
            var vs = SystemInformation.VirtualScreen;
            SetBounds(vs.Left, vs.Top, vs.Width, vs.Height);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (!DebugLog.Enabled)
                SetWindowDisplayAffinity(Handle, WDA_EXCLUDEFROMCAPTURE);

            // Re-query ClientToScreen at ~60 fps so the overlay tracks window drags live.
            _trackTimer = new System.Windows.Forms.Timer { Interval = 16 };
            _trackTimer.Tick += (_, _) => Redraw();
            _trackTimer.Start();

            Blank(); // start transparent
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            _trackTimer?.Stop(); _trackTimer?.Dispose();
            base.OnFormClosed(e);
        }

        // Electron apps (VS Code, Discord, Slack…) share Chrome's window class names,
        // so we verify by process name before caching a render widget handle.
        static bool IsActualBrowser(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            GetWindowThreadProcessId(hwnd, out uint pid);
            try
            {
                using var proc = Process.GetProcessById((int)pid);
                string name = proc.ProcessName.ToLowerInvariant();
                return name == "chrome" || name == "msedge" || name == "brave" || name == "firefox";
            }
            catch { return false; }
        }

        // Called from WebSocket thread
        public void Apply(WsMsg msg)
        {
            if (InvokeRequired) { Invoke((Action<WsMsg>)Apply, msg); return; }

            if (msg.PositionOnly && _state != null)
            {
                _state.ViewX    = msg.ViewX;
                _state.ViewY    = msg.ViewY;
                _state.Width    = msg.Width;
                _state.Height   = msg.Height;
                _state.Dpr      = msg.Dpr;
                _state.Visible  = msg.Visible;
            }
            else
            {
                _state = msg;
            }
            _stateDirty = true;

            Redraw();
        }

        void Redraw()
        {
            if (_state == null || !_state.Visible || _state.Width <= 0)
            {
                Blank(); return;
            }

            // Get the physical screen origin of Chrome's web content area.
            // Only search inside actual browser processes — prevents VS Code/Electron contamination.
            if (_cachedRenderWnd == IntPtr.Zero || !IsWindow(_cachedRenderWnd))
            {
                IntPtr fg = GetForegroundWindow();
                _cachedRenderWnd = IsActualBrowser(fg) ? FindRenderWidget(fg) : IntPtr.Zero;
            }

            var origin = new POINT { X = 0, Y = 0 };
            if (_cachedRenderWnd != IntPtr.Zero)
                ClientToScreen(_cachedRenderWnd, ref origin);

            bool moved = origin.X != _lastOrigin.X || origin.Y != _lastOrigin.Y;
            if (!moved && !_stateDirty) return; // nothing changed — skip expensive Blit

            _lastOrigin  = origin;
            _stateDirty  = false;

            if (DebugLog.Enabled)
                Console.WriteLine($"  [redraw] render=0x{_cachedRenderWnd.ToInt64():X}  origin=({origin.X},{origin.Y})  view=({_state.ViewX:F1},{_state.ViewY:F1})  w={_state.Width:F0}  dpr={_state.Dpr:F2}");

            double dpr  = _state.Dpr > 0 ? _state.Dpr : 1.0;
            int physX = origin.X + (int)Math.Round(_state.ViewX * dpr);
            int physY = origin.Y + (int)Math.Round(_state.ViewY * dpr);
            int physW = (int)Math.Round(_state.Width  * dpr);
            int physH = (int)Math.Round(_state.Height * dpr);

            var vs = SystemInformation.VirtualScreen;
            using var bmp = new Bitmap(vs.Width, vs.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode      = SmoothingMode.AntiAlias;
                g.CompositingQuality = CompositingQuality.HighQuality;

                float bx = physX - vs.Left;
                float by = physY - vs.Top;
                float bw = physW;
                float bh = physH;

                if (_state.EvalBar != null)
                    DrawEvalBar(g, bx, by, bh, _state.EvalBar);

                if (_state.Arrows != null)
                {
                    // draw least-important first so best move renders on top
                    for (int i = _state.Arrows.Length - 1; i >= 0; i--)
                        DrawArrow(g, bx, by, bw, bh, _state.Flipped, _state.Arrows[i], i);
                }

                if (DebugLog.Enabled)
                {
                    DrawDebugDot(g, origin.X - vs.Left, origin.Y - vs.Top, Color.Cyan,   "content-origin");
                    DrawDebugDot(g, bx,      by,      Color.Red,  "board-TL");
                    DrawDebugDot(g, bx + bw, by,      Color.Red,  "board-TR");
                    DrawDebugDot(g, bx,      by + bh, Color.Red,  "board-BL");
                    DrawDebugDot(g, bx + bw, by + bh, Color.Red,  "board-BR");
                }
            }

            if (DebugLog.Enabled)
                DebugLog.Position(physX, physY, physW, physH, origin.X, origin.Y, _state.ViewX, _state.ViewY, dpr);

            _isBlank = false;
            Blit(bmp, vs.Left, vs.Top);
        }

        // Walks all child windows looking for Chrome's render widget (the actual web viewport HWND).
        static IntPtr FindRenderWidget(IntPtr parent)
        {
            IntPtr found = IntPtr.Zero;
            if (parent == IntPtr.Zero) return found;
            EnumWindowsProc cb = (hwnd, _) =>
            {
                var sb = new System.Text.StringBuilder(64);
                GetClassName(hwnd, sb, sb.Capacity);
                if (sb.ToString() == "Chrome_RenderWidgetHostHWND")
                {
                    found = hwnd;
                    return false; // stop
                }
                return true;
            };
            EnumChildWindows(parent, cb, IntPtr.Zero);
            return found;
        }

        void Blank()
        {
            if (_isBlank) return;
            _isBlank    = true;
            _lastOrigin = default; // force full repaint when visible again
            _stateDirty = true;
            var vs = SystemInformation.VirtualScreen;
            using var bmp = new Bitmap(vs.Width, vs.Height, PixelFormat.Format32bppArgb);
            Blit(bmp, vs.Left, vs.Top);
        }

        static void DrawDebugDot(Graphics g, float x, float y, Color color, string label)
        {
            const float R = 7f;
            using var brush = new SolidBrush(Color.FromArgb(220, color));
            using var pen   = new Pen(Color.Black, 1.5f);
            g.FillEllipse(brush, x - R, y - R, R*2, R*2);
            g.DrawEllipse(pen,   x - R, y - R, R*2, R*2);
            Console.ForegroundColor = ConsoleColor.DarkYellow;
            Console.WriteLine($"  [dot] {label,-20} bitmap=({x:F0},{y:F0})");
            Console.ResetColor();
        }


        // ── Drawing ───────────────────────────────────────────────────────────────

        static void DrawEvalBar(Graphics g, float bx, float by, float bh, EvalBarMsg eval)
        {
            const float W = 20f, GAP = 4f;
            float x = bx - W - GAP;

            // Background
            using var bgBrush = new SolidBrush(Color.FromArgb(180, 20, 20, 20));
            g.FillRectangle(bgBrush, x, by, W, bh);

            // White/black fill
            float fill = (float)(eval.FillPercent / 100.0 * bh);
            float whiteH = eval.IsFlipped ? bh - fill : fill;
            float whiteY = eval.IsFlipped ? by : by + bh - fill;
            g.FillRectangle(Brushes.White, x, whiteY, W, whiteH);

            // Border
            using var borderPen = new Pen(Color.FromArgb(60, 255, 255, 255), 1f);
            g.DrawRectangle(borderPen, x, by, W, bh);

            // Score label
            if (!string.IsNullOrEmpty(eval.Score))
            {
                using var font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
                using var sf   = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                float labelY = eval.IsFlipped ? by + bh * 0.88f : by + bh * 0.06f;
                var labelRect = new RectangleF(x, labelY - 9, W, 18);
                g.DrawString(eval.Score, font, Brushes.Black, labelRect, sf);
            }
        }

        static readonly Color[] ArrowClr =
        {
            Color.FromArgb(210, 121, 42, 158),  // purple  — best
            Color.FromArgb(140, 184, 160,   0), // yellow  — 2nd
            Color.FromArgb(110, 184,  64,   0), // red     — 3rd
        };
        static readonly float[] ArrowW = { 2.2f, 1.8f, 1.6f };

        static void DrawArrow(Graphics g, float bx, float by, float bw, float bh, bool flipped, ArrowMsg arrow, int idx)
        {
            if (arrow.From == null || arrow.To == null || arrow.From.Length < 2 || arrow.To.Length < 2) return;

            PointF from = SquareCenter(arrow.From, bx, by, bw, bh, flipped);
            PointF to   = SquareCenter(arrow.To,   bx, by, bw, bh, flipped);

            float sqSz = bw / 8f;
            Color c    = idx < ArrowClr.Length ? ArrowClr[idx] : ArrowClr[0];
            float lw   = (idx < ArrowW.Length ? ArrowW[idx] : 2f) * sqSz / 12f;

            float dx = to.X - from.X, dy = to.Y - from.Y;
            float dist = (float)Math.Sqrt(dx * dx + dy * dy);
            if (dist < 1f) return;
            float ux = dx / dist, uy = dy / dist;
            float headLen = sqSz * 0.38f;
            float hw      = headLen * 0.44f;

            // Shaft (shortened so arrowhead doesn't overlap)
            var shaft = new PointF(to.X - ux * headLen * 0.75f, to.Y - uy * headLen * 0.75f);
            using (var pen = new Pen(c, lw) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                g.DrawLine(pen, from, shaft);

            // Arrowhead triangle
            float px = -uy, py = ux; // perpendicular unit vector
            PointF[] head =
            {
                to,
                new PointF(to.X - ux * headLen + px * hw, to.Y - uy * headLen + py * hw),
                new PointF(to.X - ux * headLen - px * hw, to.Y - uy * headLen - py * hw),
            };
            using var brush = new SolidBrush(c);
            g.FillPolygon(brush, head);
        }

        static PointF SquareCenter(string sq, float bx, float by, float bw, float bh, bool flipped)
        {
            int file = sq[0] - 'a'; // 0 = a … 7 = h
            int rank = sq[1] - '1'; // 0 = rank 1 … 7 = rank 8
            float col = flipped ? 7 - file : file;
            float row = flipped ? rank : 7 - rank;
            return new PointF(bx + (col + 0.5f) * (bw / 8f), by + (row + 0.5f) * (bh / 8f));
        }

        // ── UpdateLayeredWindow ───────────────────────────────────────────────────

        void Blit(Bitmap bmp, int x, int y)
        {
            // Lock bits (straight ARGB)
            var bd = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height),
                ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int bytes = Math.Abs(bd.Stride) * bd.Height;
            var pixels = new byte[bytes];
            Marshal.Copy(bd.Scan0, pixels, 0, bytes);
            bmp.UnlockBits(bd);

            // Premultiply alpha (required by UpdateLayeredWindow)
            for (int i = 0; i < pixels.Length; i += 4)
            {
                byte a = pixels[i + 3];
                if (a == 255) continue;
                pixels[i + 0] = (byte)(pixels[i + 0] * a / 255); // B
                pixels[i + 1] = (byte)(pixels[i + 1] * a / 255); // G
                pixels[i + 2] = (byte)(pixels[i + 2] * a / 255); // R
            }

            // Create GDI DIBSECTION and copy premultiplied pixels in
            var bi = new BITMAPINFO
            {
                biSize     = (uint)Marshal.SizeOf(typeof(BITMAPINFO)),
                biWidth    = bmp.Width,
                biHeight   = -bmp.Height, // top-down
                biPlanes   = 1,
                biBitCount = 32,
            };
            var handle = GCHandle.Alloc(pixels, GCHandleType.Pinned);
            IntPtr ppvBits;
            IntPtr hBitmap = CreateDIBSection(IntPtr.Zero, ref bi, 0, out ppvBits, IntPtr.Zero, 0);
            try
            {
                RtlMoveMemory(ppvBits, handle.AddrOfPinnedObject(), bytes);
            }
            finally { handle.Free(); }

            IntPtr hdcScreen = GetDC(IntPtr.Zero);
            IntPtr hdcMem    = CreateCompatibleDC(hdcScreen);
            IntPtr hOld      = SelectObject(hdcMem, hBitmap);
            try
            {
                var ptDst  = new POINT  { X = x, Y = y };
                var sz     = new WSIZE  { W = bmp.Width, H = bmp.Height };
                var ptSrc  = new POINT  { X = 0, Y = 0 };
                var blend  = new BLENDFUNCTION { BlendOp = AC_SRC_OVER, SourceConstantAlpha = 255, AlphaFormat = AC_SRC_ALPHA };
                UpdateLayeredWindow(Handle, hdcScreen, ref ptDst, ref sz, hdcMem, ref ptSrc, 0, ref blend, ULW_ALPHA);
            }
            finally
            {
                SelectObject(hdcMem, hOld);
                DeleteObject(hBitmap);
                DeleteDC(hdcMem);
                ReleaseDC(IntPtr.Zero, hdcScreen);
            }
        }
    }

    // ── System tray ───────────────────────────────────────────────────────────────

    sealed class TrayApp : IDisposable
    {
        readonly NotifyIcon _icon;

        public TrayApp()
        {
            Icon ico;
            try
            {
                string iconPath = System.IO.Path.Combine(
                    System.IO.Path.GetDirectoryName(Application.ExecutablePath)!,
                    "..", "..", "..", "..", "icons", "icon16.png");
                using var bmp = new Bitmap(iconPath);
                ico = Icon.FromHandle(bmp.GetHicon());
            }
            catch { ico = SystemIcons.Application; }

            var menu = new ContextMenuStrip();
            menu.Items.Add("Quit Chessist Overlay", null, (_, _) => Application.Exit());

            _icon = new NotifyIcon
            {
                Icon             = ico,
                Text             = "Chessist Overlay",
                ContextMenuStrip = menu,
                Visible          = true,
            };
        }

        public void Dispose() { _icon.Visible = false; _icon.Dispose(); }
    }

    // ── WebSocket server ──────────────────────────────────────────────────────────

    // ── Debug logger ──────────────────────────────────────────────────────────────

    static class DebugLog
    {
        public static bool Enabled { get; private set; }

        [DllImport("kernel32.dll")] static extern bool AllocConsole();

        public static void Init()
        {
            Enabled = true;
            AllocConsole();
            Console.Title = "Chessist Overlay — Debug";
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("=== Chessist Overlay Debug ===");
            Console.WriteLine($"WebSocket: ws://127.0.0.1:{WsServer.Port}");
            Console.WriteLine("Waiting for connection...\n");
            Console.ResetColor();
        }

        static int    _msgCount;
        static int    _windowCount;
        static DateTime _window = DateTime.UtcNow;

        public static void Message(string type, int bytes, bool posOnly)
        {
            _msgCount++;
            _windowCount++;

            var now  = DateTime.UtcNow;
            var secs = (now - _window).TotalSeconds;
            double rate = 0;
            if (secs >= 1.0)
            {
                rate     = _windowCount / secs;
                _window  = now;
                _windowCount = 0;
            }

            var color = type switch
            {
                "eval"         => ConsoleColor.Green,
                "positionOnly" => ConsoleColor.DarkGray,
                "disconnect"   => ConsoleColor.Red,
                "connect"      => ConsoleColor.Yellow,
                _              => ConsoleColor.White,
            };
            Console.ForegroundColor = color;
            string rateStr = rate > 0 ? $"  [{rate:F1} msg/s]" : "";
            Console.WriteLine($"[{now:HH:mm:ss.fff}] #{_msgCount,5}  {type,-14} {bytes,5}B{rateStr}");
            Console.ResetColor();
        }

        public static void Position(int physX, int physY, int physW, int physH, int originX, int originY, double viewX, double viewY, double dpr)
        {
            var vs = System.Windows.Forms.SystemInformation.VirtualScreen;
            Console.ForegroundColor = ConsoleColor.DarkCyan;
            Console.WriteLine($"                 board  phys=({physX},{physY} {physW}x{physH})  origin=({originX},{originY})  view=({viewX:F1},{viewY:F1})  dpr={dpr:F2}  vs=({vs.Left},{vs.Top})");
            Console.ResetColor();
        }
    }

    // ── WebSocket server ──────────────────────────────────────────────────────────

    sealed class WsServer
    {
        public const int Port = 27301;
        readonly OverlayForm _overlay;
        readonly DataContractJsonSerializer _ser = new(typeof(WsMsg));

        public WsServer(OverlayForm overlay) => _overlay = overlay;

        public async Task RunAsync(CancellationToken ct)
        {
            var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
            listener.Start();
            ct.Register(listener.Stop);

            while (!ct.IsCancellationRequested)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); }
                catch { break; }

                if (ctx.Request.IsWebSocketRequest)
                    _ = HandleAsync(ctx, ct);
                else
                    ctx.Response.Abort();
            }
        }

        async Task HandleAsync(HttpListenerContext ctx, CancellationToken ct)
        {
            var wsCtx = await ctx.AcceptWebSocketAsync(null);
            var ws    = wsCtx.WebSocket;
            var buf   = new byte[65536];

            if (DebugLog.Enabled) DebugLog.Message("connect", 0, false);

            try
            {
                while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var result = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                    if (result.MessageType == WebSocketMessageType.Close) break;

                    int len  = result.Count;
                    var json = Encoding.UTF8.GetString(buf, 0, len);
                    using var ms = new System.IO.MemoryStream(Encoding.UTF8.GetBytes(json));
                    var msg = (WsMsg)_ser.ReadObject(ms)!;

                    if (DebugLog.Enabled)
                        DebugLog.Message(msg.PositionOnly ? "positionOnly" : "eval", len, msg.PositionOnly);

                    _overlay.Apply(msg);
                }
            }
            catch { }
            finally
            {
                if (DebugLog.Enabled) DebugLog.Message("disconnect", 0, false);
                _overlay.Apply(new WsMsg { Visible = false });
                ws.Dispose();
            }
        }
    }

    // ── Entry point ───────────────────────────────────────────────────────────────

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool debug = Array.Exists(args, a => a.Equals("-debug", StringComparison.OrdinalIgnoreCase));
            if (debug) DebugLog.Init();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            using var cts     = new CancellationTokenSource();
            using var overlay = new OverlayForm();
            using var tray    = new TrayApp();

            Application.ApplicationExit += (_, _) => cts.Cancel();
            Task.Run(() => new WsServer(overlay).RunAsync(cts.Token));

            overlay.Show();
            Application.Run();
        }
    }
}
