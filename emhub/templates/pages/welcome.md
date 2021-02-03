
# Welcome to the CryoEM-Sweden EMhub platform

---

As part of the computational infrastructure of the SciLifeLab Cryo-EM National Facility,
we are developing a new platform (EMHub) that provides the following functionality:
 
1. Manage instrument bookings
2. Monitor data collection and pre-processing (future versions)
3. Live reports of used sessions and costs per labs/applications (future versions)

In order to access the platform, please read carefully this page and
the booking guidelines
[Booking Guideline]({{ url_for('pages.index', page_id="guidelines", _external=True) }})

## 1. Users registration

### 1.1 Application Portal
First step would be to **REGISTER** in the Application portal: 

<https://cryoem.scilifelab.se/>

PIs must also register before any of their lab members can do so.
 
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

One of the main use of the EMHub is booking instruments for sample preparation, data collection and
image processing support. 

### 2.1 Booking Calendar
Once logged in, it is possible to go the **Booking Calendar** (e.g October 2020 below):
 
<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/booking_calendar.png">

### 2.2 Select Resource to Book

Before we can make any booking, it is required to select a given resource. For example, we can select 
the **Talos**. 


<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/book_resource.png">

### 2.3 Booking Slots

To create a booking, the user should have authorization. One way is to create the booking in a 
predefined **SLOT** that has granted access to an application that the user (or its PI) is involved with.
In the previous example for the Talos, users within CEM code applications are able
to book during the weeks of October 5-10 and 19-24.

One can select one or several days (recommended max 2 days), and optional a title and a description.

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/booking_form.png">

### 2.4 Describe Experiment

It is important to describe your desired experiment before your session starts.
Experiment parameters can be set via the attached form to your booking as shown below:

<img width="75%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/booking_experiment.png">

### 2.4 Admin options

If you are part of the facility stuff, there are some extra options in the **Admin** tab, that
are not visible for other users. In this section one can create DOWNTIME, SLOTS or normal bookings.
It is also possible to create recurring events.

### 2.5 Image Processing Drop-In (Stockholm)

Now with the new EMhub  platform, it is possible to make the  booking for the drop-in service
in the same system.  You need to select **Drop-in**  as another resource.

For booking the Drop-in, it is easier to change the calendar to the Week view and then select a one-hour slot.
The  Drop-in SLOT is a bi-weekly event, from 9:00  to 16:00 with a lunch break.

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/book_dropin.png">

<img width="100%" src="https://github.com/delarosatrevin/scipion-session/wiki/images/booking_form_dropin.png">