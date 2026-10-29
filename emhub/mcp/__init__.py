"""
emhub.mcp: an MCP (Model Context Protocol) server exposing the EMhub booking
system and data processing functionality as tools for LLM agents
(Claude Desktop, Claude Code, ...).

The server talks to a running EMhub instance through its REST API, so it can
run on any machine that reaches the server. See ``emhub.mcp.server`` for the
entry point and configuration.
"""
