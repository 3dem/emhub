
Installation with Scipion
-------------------------

Requirements
............
* **git** to clone install repository and other plugins
* **wget** to download some files
* **python** to run the install script


Steps
.....

The following steps will guide you through the Scipion installation. Just be patient
for conda to resolve dependencies and environment libraries. Installation should not
require any admin privileges in your computer or compiler tools.


Replace ``SCIPION_FOLDER`` in the following command with the path where you want to
install Scipion.

.. code-block:: bash

    git clone https://github.com/delarosatrevin/scipion-install.git
    cd scipion-install
    python ./install.py SCIPION_FOLDER

After this, you should have a basic Scipion 3.0 installation in ``SCIPION_FOLDER``.
You can load the Scipion environment by:

.. code-block:: bash

    source SCIPION_FOLDER/bashrc

EMhub should also be available and ready to launch as in the previous way of
installation.

Installing other EM programs
............................

If we are installing EMhub with Scipion it is because we want to use some external
CryoEM programs to run the on-the-fly processing. Following are some instructions
to install the binaries and configure Scipion to use them.

First, let's install the binaries of some of these packages and then update
the configuration accordingly. In our case, binaries will be download/installed
under ``SCIPION_FOLDER/EM`` and this path is referred as *$EM_ROOT* in the configuration
file: ``SCIPION_FOLDER/config/scipion.conf``

After programs installation and configuration to be used within Scipion, one
can run some tests to check it is working fine. Most of these tests will download
test data under the folder ``SCIPION_FOLDER/data/tests``. Each test dataset will only
be download once if there are no changes on its files.


Motioncor
~~~~~~~~~

.. code-block:: bash

    scipion installb motioncor2

This command should download binaries and create a folder under SCIPION_FOLDER/EM.
At the moment of this writing it was ``motioncor2-1.6.4``. It should contain a *bin*
folder and under it many binaries for several CUDA versions.

Then edit SCIPION_FOLDER/config/scipion.config and set proper values for motioncor related
variables:

.. code-block:: ini

    MOTIONCOR2_CUDA_LIB = /usr/local/cuda-11.6/lib64
    MOTIONCOR2_HOME = $EM_ROOT/motioncor2-1.6.4/
    MOTIONCOR2_BIN = MotionCor2_1.6.4_Cuda116_Mar312023

To check that it is working fine we can run the following tests:

.. code-block:: bash

    scipion test motioncorr.tests.test_protocols_motioncor2.TestMotioncor2AlignMovies


Ctffind
~~~~~~~

.. code-block:: bash

    scipion installb ctffind4

Config variable:

.. code-block:: ini

    CTFFIND4_HOME = $EM_ROOT/ctffind4-4.1.13

Run test:

.. code-block:: bash

    scipion test cistem.tests.test_protocols_cistem.TestCtffind4

Cryolo
~~~~~~

.. code-block:: bash

    scipion installb cryolo cryoCPU cryolo_model

In this case, it will install two new conda environments, one for using
cryolo in GPU and another one that could be used without GPU (cryoloCPU).
Addionally, the latest cryolo trained models will be download. The config
variables specify how to active these environments. If cryolo is already
installed in your system, you can skip the previous command and just edit
the configuration accordingly.

.. code-block:: ini

    CRYOLO_ENV_ACTIVATION = conda activate cryolo-1.8.4
    CRYOLO_ENV_ACTIVATION_CPU = conda activate cryoloCPU-1.8.4
    CRYOLO_GENERIC_MODEL = $EM_ROOT/cryolo_model-202005_nn_N63_c17/gmodel_phosnet_202005_nn_N63_c17.h5

Relion
~~~~~~

Currently, Relion 4.0 is the main supported version.
It is recommended that you install Relion separately and then link it in the EM folder.
For example, if Relion is installed in your system in the path ``RELION_4.0_FOLDER``,
then one can do:


.. code-block:: bash

    cd SCIPION_FOLDER/EM
    ln -s RELION_4.0_FOLDER relion-4.0

Config variables could be something like:

.. code-block:: ini

    RELION_CUDA_LIB = /usr/local/cuda-11.6/lib64
    RELION_CUDA_BIN = /usr/local/cuda-11.6/bin
    RELION_MPI_LIB = /usr/local/mpich-3.2.1/lib
    RELION_MPI_BIN =/usr/local/mpich-3.2.1/bin
    RELION_HOME = $EM_ROOT/relion-4.0
    # Activation of the environment used for selection of good 2D classes
    RELION_ENV_ACTIVATION = conda activate topaz-0.2.5

Some test to check relion is configured properly:

.. code-block:: bash

    scipion test relion.tests.test_convert
    scipion test relion.tests.test_workflow.TestWorkflowRelionBetagal

