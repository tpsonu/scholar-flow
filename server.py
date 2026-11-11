#!/usr/bin/env python3
"""
OmniStudy (ScholarFlow) Backend Server
Serves the web application and provides REST APIs with SQLite persistence.
Zero external dependencies - runs on Python 3 standard library.
"""

import http.server
import socketserver
import json
import sqlite3
import os
import mimetypes
import urllib.parse
from datetime import datetime

PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.environ.get(
    "SCHOLAR_FLOW_DB_PATH",
    os.path.join(BASE_DIR, "database.db")
)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Key-value state storage for full application recovery
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Notes storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT,
            category TEXT,
            content TEXT,
            tags TEXT,
            voice_note_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Seed notes if empty
    cursor.execute("SELECT COUNT(*) FROM notes")
    if cursor.fetchone()[0] == 0:
        notes_seed = [
            ("note_1", "Distributed Systems: Consensus Protocols", "Computer Science", "# Distributed Systems\n- Raft Leader Election\n- Quorum replication", json.dumps(["distributed-systems", "cs"]), ""),
            ("note_2", "Cardiovascular Pathology & ECG Vignettes", "Medicine", "# Cardiology\n- Atrial fibrillation\n- Ventricular tachycardia", json.dumps(["usmle", "cardio"]), ""),
            ("note_3", "Negligence & Duty of Care Principles", "Law", "# Torts\n- Duty of care\n- Causation and remoteness", json.dumps(["law", "bar-exam"]), "")
        ]
        cursor.executemany("INSERT INTO notes (id, title, category, content, tags, voice_note_id) VALUES (?,?,?,?,?,?)", notes_seed)

    # Reminders storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            title TEXT,
            event_date TEXT,
            event_time TEXT,
            priority TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Study Partners storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS partners (
            id TEXT PRIMARY KEY,
            name TEXT,
            avatar TEXT,
            subject TEXT,
            style TEXT,
            timezone TEXT,
            bio TEXT,
            status TEXT
        )
    """)

    # Study Groups storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS study_groups (
            id TEXT PRIMARY KEY,
            name TEXT,
            topic TEXT,
            members_count INTEGER,
            description TEXT,
            pinned_note TEXT
        )
    """)

    # Followed Creators storage
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS creators (
            id TEXT PRIMARY KEY,
            name TEXT,
            platform TEXT,
            handle TEXT,
            avatar TEXT,
            category TEXT,
            last_post_title TEXT,
            last_post_time TEXT,
            last_post_url TEXT,
            unread INTEGER DEFAULT 1
        )
    """)

    # Seed study partners if empty
    cursor.execute("SELECT COUNT(*) FROM partners")
    if cursor.fetchone()[0] == 0:
        partners_seed = [
            ("p1", "Elena Rostova", "👩‍💻", "Computer Science", "Pomodoro & LeetCode", "UTC+1", "Preparing for FAANG SWE interviews & Distributed Systems.", "online"),
            ("p2", "Dr. Marcus Chen", "👨‍⚕️", "Medicine & Biology", "Flashcards & Active Recall", "UTC-5", "USMLE Step 2 study partner. Focus: Pathology & Pharmacology.", "study-mode"),
            ("p3", "Aisha Al-Mansoor", "⚖️", "Law & Jurisprudence", "Case Analysis & Debate", "UTC+4", "Corporate law bar exam review. Seeking weekly mock exam partner.", "online"),
            ("p4", "Lucas Silva", "📐", "Data Science & AI", "Project-Based & Papers", "UTC-3", "Reading arXiv ML papers & implementing PyTorch models.", "online"),
            ("p5", "Sarah Jenkins", "📊", "Business & Finance", "CFA Prep & Financial Modeling", "UTC+0", "CFA Level 1 study sprint. Daily 6 AM study sessions.", "offline")
        ]
        cursor.executemany("INSERT INTO partners VALUES (?,?,?,?,?,?,?,?)", partners_seed)

    # Seed study groups if empty
    cursor.execute("SELECT COUNT(*) FROM study_groups")
    if cursor.fetchone()[0] == 0:
        groups_seed = [
            ("g1", "Algorithms & Problem Solving", "Computer Science", 142, "Daily algorithmic puzzles, Big-O deep dives, and mock technical interviews.", "Shared LeetCode pattern cheat sheet available in notes."),
            ("g2", "USMLE / Med School Sprint", "Medicine", 89, "High-yield pathology, clinical vignettes, and pharmacology mnemonics.", "Next review session: Renal & Cardio systems this Saturday."),
            ("g3", "Deep Learning & Neural Architectures", "Artificial Intelligence", 210, "Paper reviews, Transformer architectures, and PyTorch fine-tuning labs.", "Check the compiled research notes on Attention Mechanisms.")
        ]
        cursor.executemany("INSERT INTO study_groups VALUES (?,?,?,?,?,?)", groups_seed)

    # Seed creators if empty
    cursor.execute("SELECT COUNT(*) FROM creators")
    if cursor.fetchone()[0] == 0:
        creators_seed = [
            ("c1", "3Blue1Brown", "YouTube", "@3blue1brown", "🧮", "Mathematics & Visualization", "Why neural networks actually work (Geometric intuition)", "15 minutes ago", "https://youtube.com/@3blue1brown", 1),
            ("c2", "Huberman Lab", "Instagram", "@hubermanlab", "🧠", "Neuroscience & Focus", "Protocol for optimal learning: Active recall + 90min ultradian cycles", "42 minutes ago", "https://instagram.com/hubermanlab", 1),
            ("c3", "CS50 Harvard", "YouTube", "@cs50", "💻", "Computer Science", "CS50 2026: Memory management and pointers demystified", "2 hours ago", "https://youtube.com/@cs50", 1),
            ("c4", "Ali Abdaal", "YouTube", "@aliabdaal", "⚡", "Productivity & Evidence-Based Study", "How to study for 12 hours without burnout (Retrospective Revision)", "4 hours ago", "https://youtube.com/@aliabdaal", 0),
            ("c5", "Fireship", "YouTube", "@fireship", "🔥", "Tech & Architecture", "10 Architecture Patterns in 100 Seconds", "6 hours ago", "https://youtube.com/@fireship", 0)
        ]
        cursor.executemany("INSERT INTO creators VALUES (?,?,?,?,?,?,?,?,?,?)", creators_seed)

    conn.commit()
    conn.close()

class OmniStudyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def _read_json(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        try:
            return json.loads(body.decode('utf-8'))
        except Exception:
            return {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json({"status": "ok", "app": "OmniStudy", "time": datetime.utcnow().isoformat()})
            return

        if path == "/api/state":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT key, value FROM app_state")
            rows = c.fetchall()
            state = {k: json.loads(v) for k, v in rows}
            conn.close()
            self._send_json({"status": "ok", "state": state})
            return

        if path == "/api/notes":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, title, category, content, tags, voice_note_id, created_at, updated_at FROM notes ORDER BY updated_at DESC")
            notes = [
                {
                    "id": r[0], "title": r[1], "category": r[2], "content": r[3],
                    "tags": json.loads(r[4]) if r[4] else [],
                    "voice_note_id": r[5], "created_at": r[6], "updated_at": r[7]
                }
                for r in c.fetchall()
            ]
            conn.close()
            self._send_json({"status": "ok", "notes": notes})
            return

        if path == "/api/reminders":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, title, event_date, event_time, priority, status, created_at FROM reminders ORDER BY event_date ASC, event_time ASC")
            reminders = [
                {
                    "id": r[0], "title": r[1], "event_date": r[2], "event_time": r[3],
                    "priority": r[4], "status": r[5], "created_at": r[6]
                }
                for r in c.fetchall()
            ]
            conn.close()
            self._send_json({"status": "ok", "reminders": reminders})
            return

        if path == "/api/partners":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, name, avatar, subject, style, timezone, bio, status FROM partners")
            partners = [
                {
                    "id": r[0], "name": r[1], "avatar": r[2], "subject": r[3],
                    "style": r[4], "timezone": r[5], "bio": r[6], "status": r[7]
                }
                for r in c.fetchall()
            ]
            conn.close()
            self._send_json({"status": "ok", "partners": partners})
            return

        if path == "/api/groups":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, name, topic, members_count, description, pinned_note FROM study_groups")
            groups = [
                {
                    "id": r[0], "name": r[1], "topic": r[2], "members_count": r[3],
                    "description": r[4], "pinned_note": r[5]
                }
                for r in c.fetchall()
            ]
            conn.close()
            self._send_json({"status": "ok", "groups": groups})
            return

        if path == "/api/creators":
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, name, platform, handle, avatar, category, last_post_title, last_post_time, last_post_url, unread FROM creators ORDER BY unread DESC, last_post_time ASC")
            creators = [
                {
                    "id": r[0], "name": r[1], "platform": r[2], "handle": r[3],
                    "avatar": r[4], "category": r[5], "last_post_title": r[6],
                    "last_post_time": r[7], "last_post_url": r[8], "unread": bool(r[9])
                }
                for r in c.fetchall()
            ]
            conn.close()
            self._send_json({"status": "ok", "creators": creators})
            return

        # Default: serve static files
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        if path == "/api/state":
            key = body.get("key")
            value = body.get("value")
            if not key:
                self._send_json({"error": "Missing key"}, status=400)
                return
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                      (key, json.dumps(value)))
            conn.commit()
            conn.close()
            self._send_json({"status": "ok", "message": "State synced"})
            return

        if path == "/api/notes":
            note_id = body.get("id") or f"note_{int(datetime.utcnow().timestamp()*1000)}"
            title = body.get("title", "Untitled Note")
            category = body.get("category", "General")
            content = body.get("content", "")
            tags = json.dumps(body.get("tags", []))
            voice_note_id = body.get("voice_note_id", "")

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""
                INSERT OR REPLACE INTO notes (id, title, category, content, tags, voice_note_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (note_id, title, category, content, tags, voice_note_id))
            conn.commit()
            conn.close()
            self._send_json({"status": "ok", "id": note_id})
            return

        if path == "/api/reminders":
            rem_id = body.get("id") or f"rem_{int(datetime.utcnow().timestamp()*1000)}"
            title = body.get("title", "Reminder")
            event_date = body.get("event_date", "")
            event_time = body.get("event_time", "")
            priority = body.get("priority", "medium")
            status = body.get("status", "pending")

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""
                INSERT OR REPLACE INTO reminders (id, title, event_date, event_time, priority, status)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (rem_id, title, event_date, event_time, priority, status))
            conn.commit()
            conn.close()
            self._send_json({"status": "ok", "id": rem_id})
            return

        if path == "/api/creators/mark-read":
            creator_id = body.get("id")
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            if creator_id:
                c.execute("UPDATE creators SET unread = 0 WHERE id = ?", (creator_id,))
            else:
                c.execute("UPDATE creators SET unread = 0")
            conn.commit()
            conn.close()
            self._send_json({"status": "ok"})
            return

        if path == "/api/creators":
            cid = body.get("id") or f"c_{int(datetime.utcnow().timestamp()*1000)}"
            name = body.get("name", "Creator")
            platform = body.get("platform", "YouTube")
            handle = body.get("handle", "")
            avatar = body.get("avatar", "🎬")
            category = body.get("category", "General")
            last_post = body.get("last_post_title", "New study session uploaded")
            post_time = "Just now"
            post_url = body.get("last_post_url", "#")

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""
                INSERT INTO creators (id, name, platform, handle, avatar, category, last_post_title, last_post_time, last_post_url, unread)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (cid, name, platform, handle, avatar, category, last_post, post_time, post_url))
            conn.commit()
            conn.close()
            self._send_json({"status": "ok", "id": cid})
            return

        if path == "/api/pdf/compile":
            title = body.get("title", "Compiled Notes")
            pages = body.get("pages", [])
            self._send_json({
                "status": "ok",
                "compiled": True,
                "title": title,
                "totalPages": len(pages),
                "timestamp": datetime.utcnow().isoformat()
            })
            return

        self._send_json({"error": "Endpoint not found"}, status=404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/notes/"):
            note_id = path.split("/")[-1]
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("DELETE FROM notes WHERE id = ?", (note_id,))
            conn.commit()
            conn.close()
            self._send_json({"status": "ok", "deleted": note_id})
            return

        if path.startswith("/api/reminders/"):
            rem_id = path.split("/")[-1]
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("DELETE FROM reminders WHERE id = ?", (rem_id,))
            conn.commit()
            conn.close()
            self._send_json({"status": "ok", "deleted": rem_id})
            return

        self._send_json({"error": "Endpoint not found"}, status=404)

def run_server():
    init_db()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), OmniStudyHandler) as httpd:
        print(f"==================================================")
        print(f" ScholarFlow / OmniStudy Server active on port {PORT}")
        print(f" URL: http://localhost:{PORT}")
        print(f" Serving directory: {STATIC_DIR}")
        print(f"==================================================")
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
