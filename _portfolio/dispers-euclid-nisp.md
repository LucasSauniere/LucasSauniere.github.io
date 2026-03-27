---
title: "DISPERS — PSF Modeling for Euclid NISP"
excerpt: "PhD project: modeling the instrumental response of the Euclid space telescope's NISP instrument using Zernike polynomials and deep learning.<br/>"
collection: portfolio
---

## Overview

The **DISPERS project** (at CPPM — Centre de Physique des Particules de Marseille) is dedicated to the characterization and modeling of the instrumental response of the **NISP (Near Infrared Spectrometer and Photometer)** instrument aboard the [Euclid](https://www.esa.int/Science_Exploration/Space_Science/Euclid) space telescope.

Euclid is an ESA mission launched in July 2023, designed to probe the dark universe by mapping the large-scale structure of the cosmos out to redshift ~2, covering over 15,000 square degrees of the extragalactic sky.

## My Contributions

My PhD work within DISPERS focused on:

### 1. PSF Modeling
- Simulation of Point Spread Functions (PSFs) for the NISP instrument using optical models
- Study of the impact of optical aberrations on PSF shape in low-resolution conditions

### 2. Zernike Polynomial Decomposition
- Representation of wavefront aberrations using the Zernike polynomial basis
- Development of tools to extract Zernike coefficients from observed PSFs

### 3. Deep Learning for Aberration Estimation
- Training of **Convolutional Neural Networks (CNNs)** to estimate Zernike coefficients directly from PSF images
- Development of the **Spread framework** — a complete Python package for PSF-based aberration analysis

### 4. In-orbit Validation
- Application of the methods to real in-orbit NISP data during the Euclid commissioning phase
- Participation in the Euclid Consortium's calibration working groups

## Technologies

- **Python** (NumPy, SciPy, PyTorch, TensorFlow, Astropy)
- **Optical simulation** (Zemax/OpticStudio concepts, Fourier optics)
- **Deep learning** (CNNs, autoencoders, regression networks)
- **Jupyter Notebooks**, Git, Linux HPC environments

## Publications

- *Spread: a framework for PSF-based aberration analysis* (submitted, Elsevier Measurements, 2025)
- *Decoding optical aberrations from PSFs: ML and Zernike perspectives* (SPIE 2024)
- Co-author on two additional Euclid NISP commissioning papers (SPIE 2024)
