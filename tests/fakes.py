"""Fake Gemini client for tests. No network."""

import threading
from types import SimpleNamespace

from google.genai import errors


def busy():
    return errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})


def api_error(code, message, status="ERR"):
    return errors.ClientError(code, {"error": {"code": code, "message": message, "status": status}})


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


class FakeClient:
    """replies: {model: [reply, ...]}; a reply is a JSON string, a bad string, or an Exception.

    gate: if given, each call waits for it (to simulate a slow call). started is set when a call begins.
    """

    def __init__(self, replies, listed=(), clock=None, call_seconds=1.0, gate: threading.Event | None = None):
        self.replies = {m: list(r) for m, r in replies.items()}
        self.listed = listed
        self.calls = []
        self.list_calls = 0
        self.clock = clock
        self.call_seconds = call_seconds
        self.gate = gate
        self.started = threading.Event()
        self.models = self

    def list(self):
        self.list_calls += 1
        return [SimpleNamespace(name=f"models/{n}", supported_actions=a) for n, a in self.listed]

    def generate_content(self, *, model, contents, config):
        self.calls.append((model, config, contents))
        self.started.set()
        if self.gate:
            self.gate.wait(5)
        if self.clock:
            self.clock.t += self.call_seconds
        reply = self.replies[model].pop(0)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(text=reply, candidates=[SimpleNamespace(finish_reason="STOP")])
