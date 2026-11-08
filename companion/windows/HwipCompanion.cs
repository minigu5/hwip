// 휩 Windows 보조 프로그램
// Copyright (c) 2026 Shin Mingyu
// Licensed under the repository's Custom License (Non-Commercial & Attribution).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace HwipCompanion
{
    internal static class Program
    {
        internal const string ExtensionUrl = "https://chromewebstore.google.com/detail/meahkfhlalnljlgllhmhmfdhpkknfncg";
        internal const string RunValueName = "HwipCompanion";

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool portable = Array.IndexOf(args, "--portable") >= 0;
            bool installedLaunch = Array.IndexOf(args, "--installed") >= 0;
            if (!portable && !installedLaunch && !Installer.IsInstalledExecutable())
            {
                Installer.RunFirstInstall();
                return;
            }

            bool created;
            using (var mutex = new Mutex(true, "Local\\HwipCompanion-38473", out created))
            {
                if (!created)
                {
                    MessageBox.Show("휩 수식 개체 복사가 이미 실행 중입니다.", "휩", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.Run(new CompanionContext());
            }
        }
    }

    internal static class Installer
    {
        internal static string InstallDirectory
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hwip"); }
        }

        internal static string InstalledExecutable
        {
            get { return Path.Combine(InstallDirectory, "HwipCompanion.exe"); }
        }

        internal static bool IsInstalledExecutable()
        {
            return String.Equals(Path.GetFullPath(Application.ExecutablePath), Path.GetFullPath(InstalledExecutable), StringComparison.OrdinalIgnoreCase);
        }

        internal static void RunFirstInstall()
        {
            DialogResult choice = MessageBox.Show(
                "휩 Windows 프로그램을 설치하고 크롬 확장 설치 페이지를 여시겠습니까?\n\n" +
                "설치 후에는 Windows 시작 시 자동으로 실행됩니다. 크롬에서는 '확장 프로그램 추가'를 한 번 눌러 주세요.",
                "휩 설치", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Information);
            if (choice == DialogResult.Cancel) return;
            if (choice == DialogResult.No)
            {
                Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--portable") { UseShellExecute = true });
                return;
            }

            try
            {
                Directory.CreateDirectory(InstallDirectory);
                File.Copy(Application.ExecutablePath, InstalledExecutable, true);
                SetAutoStart(true);
                Process.Start(new ProcessStartInfo(InstalledExecutable, "--installed") { UseShellExecute = true });
                OpenExtensionStore();
                MessageBox.Show(
                    "Windows 프로그램 설치가 완료되었습니다.\n\n열린 크롬 웹스토어에서 '확장 프로그램 추가'를 누르면 준비가 끝납니다.",
                    "휩 설치 완료", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show("설치하지 못했습니다: " + ex.Message, "휩 설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        internal static bool IsAutoStartEnabled()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                return key != null && key.GetValue(Program.RunValueName) != null;
        }

        internal static void SetAutoStart(bool enabled)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
            {
                if (enabled) key.SetValue(Program.RunValueName, "\"" + InstalledExecutable + "\" --installed");
                else key.DeleteValue(Program.RunValueName, false);
            }
        }

        internal static void OpenExtensionStore()
        {
            Process.Start(new ProcessStartInfo(Program.ExtensionUrl) { UseShellExecute = true });
        }
    }

    internal sealed class CompanionContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly EquationClipboard equationClipboard;
        private readonly LocalServer server;
        private readonly Control dispatcher;
        private readonly ClipboardWatcher clipboardWatcher;
        private ToolStripMenuItem autoConvertMenu;
        private ToolStripMenuItem autoStartMenu;

        internal CompanionContext()
        {
            equationClipboard = new EquationClipboard();
            dispatcher = new Control();
            dispatcher.CreateControl();
            server = new LocalServer(CopyEquationOnUiThread);
            tray = new NotifyIcon
            {
                Icon = System.Drawing.SystemIcons.Application,
                Text = "휩 - 한글 수식 개체 복사",
                Visible = true,
                ContextMenuStrip = BuildMenu()
            };
            clipboardWatcher = new ClipboardWatcher(OnClipboardTextChanged);
            tray.ShowBalloonTip(2500, "휩", "한글 수식 개체 복사 준비가 완료되었습니다.", ToolTipIcon.Info);
            server.Start();
        }

        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("실행 중 - 127.0.0.1:38473").Enabled = false;
            autoConvertMenu = new ToolStripMenuItem("복사한 HWP 수식 자동 개체 변환") { Checked = true, CheckOnClick = true };
            menu.Items.Add(autoConvertMenu);
            bool installed = Installer.IsInstalledExecutable();
            autoStartMenu = new ToolStripMenuItem("Windows 시작 시 자동 실행")
            {
                Checked = installed && Installer.IsAutoStartEnabled(),
                CheckOnClick = true,
                Enabled = installed
            };
            autoStartMenu.CheckedChanged += delegate
            {
                try { Installer.SetAutoStart(autoStartMenu.Checked); }
                catch (Exception ex) { MessageBox.Show("자동 실행 설정을 변경하지 못했습니다: " + ex.Message, "휩", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            menu.Items.Add(autoStartMenu);
            menu.Items.Add("크롬 확장 설치 페이지 열기", null, delegate { Installer.OpenExtensionStore(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("종료", null, delegate { ExitThread(); });
            return menu;
        }

        private void OnClipboardTextChanged(string text)
        {
            if (autoConvertMenu == null || !autoConvertMenu.Checked || !LooksLikeHwpEquation(text)) return;
            try
            {
                CopyResult result = equationClipboard.Copy(text);
                if (result.success)
                    tray.ShowBalloonTip(1200, "휩", "복사한 수식을 한글 수식 개체로 변환했습니다. 한글에서 Ctrl+V 하세요.", ToolTipIcon.Info);
                else
                    tray.ShowBalloonTip(2500, "휩", result.message, ToolTipIcon.Warning);
            }
            catch (Exception ex)
            {
                tray.ShowBalloonTip(2500, "휩", FriendlyError(ex), ToolTipIcon.Error);
            }
        }

        private static bool LooksLikeHwpEquation(string text)
        {
            if (String.IsNullOrWhiteSpace(text) || text.Length > 50000) return false;
            // 변환기가 이항 연산자 주변에 넣는 1/4칸 표식.
            if (Regex.IsMatch(text, "`[+\\-*/=<>:]`")) return true;
            // 첨자 또는 한글 수식 구조 명령이 있으면 수식 문법으로 간주한다.
            if (Regex.IsMatch(text, @"(?:_|\^)\s*\{[^{}]*\}")) return true;
            return Regex.IsMatch(text,
                @"(?:^|\s)(?:over|atop|sqrt|sum|prod|int|oint|dint|tint|lim|Lim|matrix|pmatrix|bmatrix|dmatrix|cases|pile|REL|LEFT|RIGHT|CHOOSE|BINOM|COLOR|LSUB|LSUP|LADDER|SLADDER|LONGDIV)(?=\s|\{|\(|\[)",
                RegexOptions.IgnoreCase);
        }

        private CopyResult CopyEquationOnUiThread(string equation, int timeoutMs)
        {
            CopyResult result = null;
            Exception error = null;
            using (var completed = new ManualResetEvent(false))
            {
                dispatcher.BeginInvoke((MethodInvoker)delegate
                {
                    try { result = equationClipboard.Copy(equation); }
                    catch (Exception ex) { error = ex; }
                    finally { completed.Set(); }
                });
                if (!completed.WaitOne(timeoutMs)) return CopyResult.Fail("TIMEOUT", "한글 수식 개체 생성 시간이 초과되었습니다.");
            }
            if (error != null) return CopyResult.Fail("HWP_ERROR", FriendlyError(error));
            return result ?? CopyResult.Fail("UNKNOWN", "수식 개체를 만들지 못했습니다.");
        }

        private static string FriendlyError(Exception error)
        {
            string message = error.Message ?? "알 수 없는 오류";
            if (message.IndexOf("ProgID", StringComparison.OrdinalIgnoreCase) >= 0 ||
                message.IndexOf("클래스", StringComparison.OrdinalIgnoreCase) >= 0)
                return "설치형 한글을 찾을 수 없습니다. 한컴오피스 한글 설치 여부를 확인해 주세요.";
            return "한글에서 수식 개체를 만들지 못했습니다: " + message;
        }

        protected override void ExitThreadCore()
        {
            server.Dispose();
            clipboardWatcher.Dispose();
            equationClipboard.Dispose();
            dispatcher.Dispose();
            tray.Visible = false;
            tray.Dispose();
            base.ExitThreadCore();
        }
    }

    internal sealed class ClipboardWatcher : NativeWindow, IDisposable
    {
        private const int WmClipboardUpdate = 0x031D;
        private readonly Action<string> onText;
        private readonly System.Windows.Forms.Timer debounce;

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool AddClipboardFormatListener(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

        internal ClipboardWatcher(Action<string> onText)
        {
            this.onText = onText;
            CreateHandle(new CreateParams());
            if (!AddClipboardFormatListener(Handle)) throw new InvalidOperationException("클립보드 감시를 시작하지 못했습니다.");
            debounce = new System.Windows.Forms.Timer { Interval = 120 };
            debounce.Tick += delegate
            {
                debounce.Stop();
                TryReadClipboard();
            };
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmClipboardUpdate)
            {
                debounce.Stop();
                debounce.Start();
            }
            base.WndProc(ref m);
        }

        private void TryReadClipboard()
        {
            try
            {
                IDataObject data = Clipboard.GetDataObject();
                if (data == null || data.GetDataPresent("Hwp Native", false)) return;
                if (!data.GetDataPresent(DataFormats.UnicodeText, true)) return;
                string text = data.GetData(DataFormats.UnicodeText, true) as string;
                if (!String.IsNullOrEmpty(text)) onText(text);
            }
            catch (ExternalException)
            {
                // 다른 앱이 클립보드를 잠깐 점유한 경우 다음 복사 이벤트에서 다시 시도한다.
            }
        }

        public void Dispose()
        {
            debounce.Stop();
            debounce.Dispose();
            if (Handle != IntPtr.Zero) RemoveClipboardFormatListener(Handle);
            DestroyHandle();
        }
    }

    internal sealed class EquationClipboard : IDisposable
    {
        private dynamic hwp;

        [DllImport("ole32.dll")]
        private static extern int OleFlushClipboard();

        internal CopyResult Copy(string equation)
        {
            EnsureHwp();
            ResetDocument();

            dynamic parameters = hwp.HParameterSet.HEqEdit;
            hwp.HAction.GetDefault("EquationCreate", parameters.HSet);
            parameters.EqFontName = "HancomEQN";
            parameters.String = equation;
            parameters.BaseUnit = hwp.PointToHwpUnit(10.0);
            bool inserted = hwp.HAction.Execute("EquationCreate", parameters.HSet);
            if (!inserted) return CopyResult.Fail("EQUATION_CREATE_FAILED", "한글이 수식 개체 생성을 거부했습니다.");

            hwp.FindCtrl();
            // 일부 한글 버전의 Run은 성공해도 반환값이 없는 COM 메서드다.
            hwp.Run("Copy");
            Thread.Sleep(80);
            OleFlushClipboard();
            return CopyResult.Ok();
        }

        private void EnsureHwp()
        {
            if (hwp != null) return;
            Type type = Type.GetTypeFromProgID("HWPFrame.HwpObject");
            if (type == null) throw new InvalidOperationException("HWPFrame.HwpObject ProgID를 찾을 수 없습니다.");
            hwp = Activator.CreateInstance(type);
            if (hwp.XHwpDocuments.Count == 0) hwp.XHwpDocuments.Add();
            hwp.XHwpWindows.Item(0).Visible = false;
        }

        private void ResetDocument()
        {
            hwp.Run("MoveDocBegin");
            hwp.Run("SelectAll");
            hwp.Run("Delete");
        }

        public void Dispose()
        {
            if (hwp == null) return;
            try { hwp.Clear(1); } catch { }
            try { hwp.Quit(); } catch { }
            try { Marshal.FinalReleaseComObject(hwp); } catch { }
            hwp = null;
        }
    }

    internal sealed class LocalServer : IDisposable
    {
        private const int Port = 38473;
        private const int MaxBodyBytes = 1024 * 1024;
        private const int MaxEquationChars = 50000;
        private const int OperationTimeoutMs = 15000;
        private readonly Func<string, int, CopyResult> copyEquation;
        private readonly SemaphoreSlim operation = new SemaphoreSlim(1, 1);
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MaxBodyBytes };
        private TcpListener listener;
        private Thread listenThread;
        private volatile bool stopping;

        internal LocalServer(Func<string, int, CopyResult> copyEquation) { this.copyEquation = copyEquation; }

        internal void Start()
        {
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start(8);
            listenThread = new Thread(ListenLoop) { IsBackground = true, Name = "HwipLocalServer" };
            listenThread.Start();
        }

        private void ListenLoop()
        {
            while (!stopping)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(delegate { Handle(client); });
                }
                catch (SocketException) { if (!stopping) Thread.Sleep(100); }
                catch (ObjectDisposedException) { return; }
            }
        }

        private void Handle(TcpClient client)
        {
            using (client)
            {
                client.ReceiveTimeout = 5000;
                client.SendTimeout = 5000;
                try
                {
                    Request req = ReadRequest(client.GetStream());
                    if (req == null) return;
                    if (!IsAllowedOrigin(req.Origin)) { Write(client, 403, req.Origin, CopyResult.Fail("ORIGIN_DENIED", "허용되지 않은 웹사이트입니다.")); return; }
                    if (req.Method == "OPTIONS") { Write(client, 204, req.Origin, null); return; }
                    if (req.Method == "GET" && req.Path == "/health") { Write(client, 200, req.Origin, new Dictionary<string, object> { { "ok", true }, { "version", "1.0.0" } }); return; }
                    if (req.Method != "POST" || req.Path != "/v1/equation/copy") { Write(client, 404, req.Origin, CopyResult.Fail("NOT_FOUND", "지원하지 않는 요청입니다.")); return; }

                    var payload = json.Deserialize<Dictionary<string, object>>(req.BodyText);
                    string equation = payload != null && payload.ContainsKey("equation") ? Convert.ToString(payload["equation"]) : null;
                    if (String.IsNullOrWhiteSpace(equation)) { Write(client, 400, req.Origin, CopyResult.Fail("EQUATION_REQUIRED", "수식 문자열이 필요합니다.")); return; }
                    if (equation.Length > MaxEquationChars) { Write(client, 413, req.Origin, CopyResult.Fail("EQUATION_TOO_LONG", "수식은 최대 50,000자까지 처리할 수 있습니다.")); return; }
                    if (!operation.Wait(0)) { Write(client, 409, req.Origin, CopyResult.Fail("BUSY", "다른 수식을 처리 중입니다.")); return; }
                    try
                    {
                        CopyResult result = copyEquation(equation, OperationTimeoutMs);
                        Write(client, result.success ? 200 : 500, req.Origin, result);
                    }
                    finally { operation.Release(); }
                }
                catch (RequestTooLargeException ex) { Write(client, 413, null, CopyResult.Fail("REQUEST_TOO_LARGE", ex.Message)); }
                catch (Exception ex) { Write(client, 400, null, CopyResult.Fail("BAD_REQUEST", ex.Message)); }
            }
        }

        private static Request ReadRequest(Stream stream)
        {
            var header = new List<byte>();
            int matched = 0;
            while (header.Count < 16384)
            {
                int b = stream.ReadByte();
                if (b < 0) return null;
                header.Add((byte)b);
                int[] end = { 13, 10, 13, 10 };
                matched = b == end[matched] ? matched + 1 : (b == 13 ? 1 : 0);
                if (matched == 4) break;
            }
            if (matched != 4) throw new InvalidDataException("HTTP 헤더가 너무 크거나 올바르지 않습니다.");
            string text = Encoding.ASCII.GetString(header.ToArray());
            string[] lines = text.Split(new[] { "\r\n" }, StringSplitOptions.None);
            string[] first = lines[0].Split(' ');
            if (first.Length < 2) throw new InvalidDataException("올바르지 않은 HTTP 요청입니다.");
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon > 0) headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
            }
            int length = 0;
            if (headers.ContainsKey("Content-Length") && !Int32.TryParse(headers["Content-Length"], out length)) throw new InvalidDataException("Content-Length가 올바르지 않습니다.");
            if (length < 0 || length > MaxBodyBytes) throw new RequestTooLargeException("요청 본문은 최대 1MB까지 허용됩니다.");
            byte[] body = new byte[length];
            int offset = 0;
            while (offset < length)
            {
                int read = stream.Read(body, offset, length - offset);
                if (read <= 0) throw new EndOfStreamException("요청 본문이 중간에 끝났습니다.");
                offset += read;
            }
            string origin = headers.ContainsKey("Origin") ? headers["Origin"] : null;
            return new Request { Method = first[0].ToUpperInvariant(), Path = first[1].Split('?')[0], Origin = origin, BodyText = Encoding.UTF8.GetString(body) };
        }

        private static bool IsAllowedOrigin(string origin)
        {
            if (String.IsNullOrEmpty(origin)) return false;
            if (origin == "https://hwip.dshs.dev" || origin == "https://www.hwip.dshs.dev") return true;
            Uri uri;
            return Uri.TryCreate(origin, UriKind.Absolute, out uri) && uri.Scheme == "http" &&
                   (uri.Host == "127.0.0.1" || uri.Host == "localhost");
        }

        private void Write(TcpClient client, int status, string origin, object value)
        {
            byte[] body = value == null ? new byte[0] : Encoding.UTF8.GetBytes(json.Serialize(value));
            string reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 400 ? "Bad Request" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : status == 413 ? "Payload Too Large" : "Internal Server Error";
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            sb.Append("Content-Type: application/json; charset=utf-8\r\nContent-Length: ").Append(body.Length).Append("\r\nConnection: close\r\n");
            if (!String.IsNullOrEmpty(origin)) sb.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\nVary: Origin\r\n");
            sb.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n");
            sb.Append("Cache-Control: no-store\r\n\r\n");
            byte[] headers = Encoding.ASCII.GetBytes(sb.ToString());
            Stream stream = client.GetStream();
            stream.Write(headers, 0, headers.Length);
            if (body.Length > 0) stream.Write(body, 0, body.Length);
        }

        public void Dispose()
        {
            stopping = true;
            if (listener != null) listener.Stop();
            if (listenThread != null && listenThread.IsAlive) listenThread.Join(1000);
            operation.Dispose();
        }
    }

    internal sealed class Request { internal string Method, Path, Origin, BodyText; }
    internal sealed class RequestTooLargeException : Exception { internal RequestTooLargeException(string message) : base(message) { } }

    internal sealed class CopyResult
    {
        public bool success { get; set; }
        public string code { get; set; }
        public string message { get; set; }
        internal static CopyResult Ok() { return new CopyResult { success = true, code = "OK", message = "한글 수식 개체를 클립보드에 복사했습니다." }; }
        internal static CopyResult Fail(string code, string message) { return new CopyResult { success = false, code = code, message = message }; }
    }
}
