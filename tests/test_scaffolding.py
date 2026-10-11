def test_package_import():
    import heloc
    assert hasattr(heloc, "__version__")
    assert heloc.__version__ == "0.1.0"
    assert heloc.__doc__ == "Localized HELOC Simulation Engine & Antigravity Agent Tool."
