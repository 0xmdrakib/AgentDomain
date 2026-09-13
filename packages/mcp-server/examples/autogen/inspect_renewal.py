"""Compatibility CLI; all logic lives in the installed Python package."""

from agentdomain_autogen.cli import main, parser, run

__all__ = ["main", "parser", "run"]

if __name__ == "__main__":
    main()
