# ADR 0003: OllaBridge is transport, not business logic

Status: Accepted

Remote clients authenticate and reach the owner's HomePilot node through OllaBridge. OllaBridge does not implement wardrobe semantics. SmartMirror-specific requests execute behind HomePilot through MCP.
