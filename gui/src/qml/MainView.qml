import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Controls.Material

import org.streetpea.chiaking

Pane {
    padding: 0
    id: consolePane
    StackView.onActivated: {
        forceActiveFocus(Qt.TabFocusReason);
        if(!Chiaki.autoConnect && !root.initialAsk && !Chiaki.window.directStream)
        {
            root.initialAsk = true;
            if(Chiaki.settings.addSteamShortcutAsk && (typeof Chiaki.createSteamShortcut === "function"))
                root.showRemindDialog(qsTr("Official Steam artwork + controller layout"), qsTr("Would you like to either create a new non-Steam game for chiaki-ng\nor update an existing non-Steam game with the official artwork and controller layout?") + "\n\n" + qsTr("(Note: If you select no now and want to do this later, click the button or press R3 from the main menu.)"), false, () => root.showSteamShortcutDialog(true));
            else if(Chiaki.settings.remotePlayAsk)
            {
                if(!Chiaki.settings.psnRefreshToken || !Chiaki.settings.psnAuthToken || !Chiaki.settings.psnAuthTokenExpiry || !Chiaki.settings.psnAccountId)
                    root.showRemindDialog(qsTr("Remote Play via PSN"), qsTr("Would you like to connect to PSN?\nThis enables:\n- Automatic registration\n- Playing outside of your home network without port forwarding?") + "\n\n" + qsTr("(Note: If you select no now and want to do this later, go to the Config section of the settings.)"), true, () => root.showPSNTokenDialog(false));
                else
                    Chiaki.settings.remotePlayAsk = false;
            }
        }
    }
    Keys.onUpPressed: {
        if(hostsView.currentItem && hostsView.currentItem.visible)
        {
            hostsView.decrementCurrentIndex()
            while(!hostsView.currentItem.visible)
                hostsView.decrementCurrentIndex()
        }
    }
    Keys.onDownPressed: {
        if(hostsView.currentItem && hostsView.currentItem.visible)
        {
            hostsView.incrementCurrentIndex()
            while(!hostsView.currentItem.visible)
                 hostsView.incrementCurrentIndex()
        }
    }
    Keys.onMenuPressed: settingsButton.clicked()
    Keys.onReturnPressed: if (hostsView.currentItem) hostsView.currentItem.connectToHost()
    Keys.onYesPressed: if (hostsView.currentItem) hostsView.currentItem.wakeUpHost()
    Keys.onNoPressed: if (hostsView.currentItem) hostsView.currentItem.deleteHost()
    Keys.onEscapePressed: root.showConfirmDialog(qsTr("Quit"), qsTr("Are you sure you want to quit?"), () => Qt.quit())
    Keys.onPressed: (event) => {
        if (event.modifiers)
            return;
        switch (event.key) {
        case Qt.Key_PageUp:
            if (hostsView.currentItem) hostsView.currentItem.setConsolePin();
            event.accepted = true;
            break;
        case Qt.Key_PageDown:
            if (Chiaki.settings.psnAuthToken) Chiaki.refreshPsnToken();
            event.accepted = true;
            break;
        import QtQuick
        import QtQuick.Layouts
        import QtQuick.Controls
        import QtQuick.Controls.Material

        import org.streetpea.chiaking

        Pane {
            id: consolePane
            padding: 0

            Keys.onEscapePressed: root.showConfirmDialog(qsTr("Quit"), qsTr("Are you sure you want to quit?"), () => Qt.quit())

            // Top app bar
            Rectangle {
                id: appBar
                color: Material.background
                height: 72
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                border.width: 0

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 16

                    Image {
                        source: "qrc:/icons/auroraplay.svg"
                        width: 48
                        height: 48
                        fillMode: Image.PreserveAspectFit
                    }

                    Label {
                        text: qsTr("AuroraPlay")
                        font.pixelSize: 22
                        verticalAlignment: Text.AlignVCenter
                    }

                    Item { Layout.fillWidth: true }

                    Button {
                        id: settingsButton
                        text: qsTr("Settings")
                        onClicked: root.showSettingsDialog()
                        Material.rounded: true
                    }
                }
            }

            // Main content: hosts grid for a modern card layout
            GridView {
                id: hostsGrid
                anchors {
                    top: appBar.bottom
                    left: parent.left
                    right: parent.right
                    bottom: parent.bottom
                    margins: 20
                }
                cellWidth: 360
                cellHeight: 180
                model: Chiaki.hosts
                spacing: 20

                delegate: Rectangle {
                    id: card
                    width: hostsGrid.cellWidth
                    height: hostsGrid.cellHeight
                    radius: 12
                    color: Material.background
                    border.color: Qt.rgba(1,1,1,0.04)
                    elevation: ListView.isCurrentItem ? 8 : 2
                    property bool visibleCard: modelData.display
                    visible: visibleCard

                    MouseArea {
                        anchors.fill: parent
                        onClicked: {
                            if (modelData.discovered)
                                Chiaki.connectToHost(index, modelData.name)
                            else
                                Chiaki.connectToHost(index)
                        }
                    }

                    RowLayout {
                        anchors.fill: parent
                        anchors.margins: 16
                        spacing: 12

                        Image {
                            width: 120
                            height: 120
                            fillMode: Image.PreserveAspectFit
                            source: "image://svg/console-ps" + (modelData.ps5 ? "5" : "4") + (modelData.state == "standby" ? "#light_standby" : "#light_on")
                        }

                        ColumnLayout {
                            spacing: 6
                            anchors.verticalCenter: parent.verticalCenter
                            Label { text: modelData.name ? modelData.name : qsTr("Unnamed"); font.pixelSize: 18 }
                            Label { text: modelData.address ? qsTr("%1").arg(Chiaki.settings.streamerMode ? qsTr("hidden") : modelData.address) : ""; color: Qt.rgba(1,1,1,0.6) }
                            Label { text: modelData.mac ? (qsTr("ID: %1").arg(Chiaki.settings.streamerMode ? qsTr("hidden") : modelData.mac)) : ""; color: Qt.rgba(1,1,1,0.5) }

                            RowLayout { spacing: 8 }
                        }

                        Item { Layout.fillWidth: true }

                        ColumnLayout {
                            spacing: 8
                            anchors.verticalCenter: parent.verticalCenter

                            Button { text: qsTr("Connect"); onClicked: { if(modelData.discovered) Chiaki.connectToHost(index, modelData.name); else Chiaki.connectToHost(index); } }
                            Button { text: qsTr("Wake"); visible: modelData.registered && !modelData.duid && !modelData.discovered; onClicked: { Chiaki.wakeUpHost(index) } }
                            Button { text: modelData.manual ? qsTr("Delete") : qsTr("Hide"); visible: modelData.manual || (modelData.discovered && !modelData.registered); onClicked: { if(modelData.manual) root.showConfirmDialog(qsTr("Delete Console"), qsTr("Are you sure you want to delete this console?"), () => {Chiaki.deleteHost(index)}); else root.showConfirmDialog(qsTr("Hide Console"), qsTr("Are you sure you want to hide this console?"), () => Chiaki.hideHost(modelData.mac, modelData.name)); } }
                        }
                    }
                }
            }

            // Floating action button for quick actions
            Rectangle {
                id: fab
                width: 64
                height: 64
                radius: 32
                color: Material.accent
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 24
                elevation: 12

                MouseArea { anchors.fill: parent; onClicked: root.showManualHostDialog() }
                Label { anchors.centerIn: parent; text: "+"; color: "white"; font.pixelSize: 28 }
            }
        }
                    hostsView.incrementCurrentIndex()
