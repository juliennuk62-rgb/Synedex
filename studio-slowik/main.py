"""Studio SLOWIK - point d'entree du logiciel."""
from ui.app import App


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
