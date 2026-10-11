def test_package_import():
    import heloc
    assert hasattr(heloc, "__version__")
    assert heloc.__version__ == "0.1.0"
