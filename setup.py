from setuptools import setup, find_packages

setup(
    name="trader-robot",
    version="4.0.0",
    packages=find_packages(),
    install_requires=[
        "pandas>=2.0.0",
        "numpy>=1.24.0",
        "requests>=2.31.0",
        "python-dotenv>=1.0.0",
    ],
    entry_points={
        "console_scripts": [
            "trader-robot=trader_robot.main:main",
        ],
    },
    python_requires=">=3.9",
)
