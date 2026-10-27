// Ayudante del control remoto en Windows: lee órdenes (una por línea, en JSON sencillo) y mueve el ratón y
// pulsa teclas con SetCursorPos, mouse_event y keybd_event. Lo lanza la app solo mientras alguien tiene el
// control. Mismas órdenes que el de Mac (helper/mac.swift), con posiciones en píxeles físicos y "k" como
// código de tecla virtual de Windows.
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

static class Ayudante
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

    const uint LEFTDOWN = 0x02, LEFTUP = 0x04, RIGHTDOWN = 0x08, RIGHTUP = 0x10, MIDDLEDOWN = 0x20, MIDDLEUP = 0x40;
    const uint WHEEL = 0x0800, HWHEEL = 0x1000, KEYUP = 0x02, EXTENDED = 0x01;

    static double Num(string s, string k)
    {
        var m = Regex.Match(s, "\"" + k + "\"\\s*:\\s*(-?[0-9.eE+-]+)");
        return m.Success ? double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
    }
    static string Str(string s, string k)
    {
        var m = Regex.Match(s, "\"" + k + "\"\\s*:\\s*\"([a-z]+)\"");
        return m.Success ? m.Groups[1].Value : "";
    }
    static bool Bool(string s, string k) { return Regex.IsMatch(s, "\"" + k + "\"\\s*:\\s*true"); }

    // Flechas, Inicio, Fin, RePág, AvPág, Insertar, Suprimir, teclas de la derecha...: teclas "extendidas"
    static bool Extended(int vk)
    {
        return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5 || vk == 0x6F;
    }

    static void Main()
    {
        SetProcessDPIAware();
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            var t = Str(line, "t");
            int x = (int)Math.Round(Num(line, "x")), y = (int)Math.Round(Num(line, "y")), b = (int)Num(line, "b");
            if (t == "move") SetCursorPos(x, y);
            else if (t == "down" || t == "up")
            {
                SetCursorPos(x, y);
                bool down = t == "down";
                uint f = b == 2 ? (down ? RIGHTDOWN : RIGHTUP) : b == 1 ? (down ? MIDDLEDOWN : MIDDLEUP) : (down ? LEFTDOWN : LEFTUP);
                mouse_event(f, 0, 0, 0, UIntPtr.Zero);
            }
            else if (t == "scroll")
            {
                int dy = (int)Math.Round(-Num(line, "dy") * 1.2), dx = (int)Math.Round(Num(line, "dx") * 1.2);
                if (dy != 0) mouse_event(WHEEL, 0, 0, dy, UIntPtr.Zero);
                if (dx != 0) mouse_event(HWHEEL, 0, 0, dx, UIntPtr.Zero);
            }
            else if (t == "key")
            {
                int vk = (int)Num(line, "k");
                if (vk <= 0 || vk > 254) continue;
                uint f = (Bool(line, "down") ? 0 : KEYUP) | (Extended(vk) ? EXTENDED : 0);
                keybd_event((byte)vk, (byte)MapVirtualKey((uint)vk, 0), f, UIntPtr.Zero);
            }
        }
    }
}
