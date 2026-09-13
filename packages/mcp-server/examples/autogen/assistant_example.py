"""Compatibility CLI for the installed package\'s real AssistantAgent."""

from agentdomain_autogen.assistant import SYSTEM_MESSAGE, create_assistant, main

__all__ = ["SYSTEM_MESSAGE", "create_assistant", "main"]

if __name__ == "__main__":
    main()
