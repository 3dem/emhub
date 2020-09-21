
# Welcome to the new EMHub platform

As part of the computational infrastructure of the SciLifeLab Cryo-EM Facility, 
we are developing a new platform (EMHub) that provides the following functionality:
 
1. Manage all instrument bookings, both for internal and external users
2. Monitor data collection and pre-processing (future versions)
3. Live reports of used sessions and costs per labs/applications (future versions)

In order to access the platform, please read carefully the following guideline.

## 1. Users registration

### 1.1 Application Portal
First step would be to **REGISTER** in the Application portal: 

<https://cryoem.scilifelab.se/>

Group PIs should also be registered before any member of its lab can do it.
 
### 1.2 Reset password in EMHub 

After your user is approved in the Application Portal, it will be transferred to 
the new EMHub system. Nonetheless, you still need to set the password again in the 
new system. 

For doing that, go to the following link:

<https://emhub.cryoem.se/main?content_id=user_reset_password>

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/reset_password.png">

Enter your email (the same one used in the portal) and click on **Reset Password**.
An email should be sent to your account with a link to reset your password.

After following the link, you should be able to change your password or any other
information in your profile, such as you photo or phone. 
 
**IMAGE HERE**


## 2. Create Bookings

One of the main use of the EMHub is to booking instruments for sample preparation, data collection and 
image processing support. 

### 2.1 Booking Calendar
After an user is logged in, it is possible to go the **Booking Calendar** (e.g October 2020 below):
 
<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/booking_calendar.png">

### 2.2 Select Resource to Book

Before we can make any booking, it is required to select a given resource. For example, we can select 
the **Talos**. 


<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/book_resource.png">

#### 2.1 Booking Slots

To create a booking, the user should have authorization. One way is to create the booking in a 
predefined **SLOT** that has granted access to an application that the user (or its PI) is involved.
In the previous example for the Talos, all national users (all applications with CEM code) are able
to book during the weeks of October 5-10 and 19-24. 
Internal users will not be able to book during these weeks, but can book in available free days 
(e.g Tuesday September 29 or October 14 or 17).

One can select one or several days (recommended max 2 days) and optional set a title and description. 

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/booking_form.png">

### Falcon 3

If you are using the Falcon 3, first you need to select the folder name in EPU for storing the images. We recommend to follow the convention of project code + '_epu' (e.g, dbb00072_epu, sll00069_epu, etc). Then the raw data can be found in `/mnt/krios-falcon3` (or `/mnt/talos-falcon3`). You can use the command `copy-falcon3-data` (using `rsync` internally) to copy the data to your project folder as in the example shown below (change to your own data folder):

```
$ copy-falcon3-data /mnt/talos-falcon3/dbb00073_20180126_EPU
```

The following lines are the output from the command (no need to be executed by the user)

```Output folder: /data/staging/dbb/dbb00073/f3_frames```

```rsync -avuP /mnt/talos-falcon3/dbb00073_20180126_EPU/ /data/staging/dbb/dbb00073/f3_frames/```

```rsync -avuP /mnt/talos-falcon3/dbb00073_20180126_EPU/ /data/staging/dbb/dbb00073/f3_frames/```


## 4. Execute Scipion streaming pipeline

If you have selected to use Scipion for streaming pre-processing, then you should get a newly created Scipion project. After you You can then go through each protocol, provide input parameters for each protocol and execute them. If everything went fine, you should have now running protocols (yellow boxes) as shown below:

<img src="https://github.com/delarosatrevin/scipion-session/wiki/images/scipion-project.png">
